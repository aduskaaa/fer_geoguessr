/* ==========================================================
   Far East Russia – Optimized Canvas Map Engine
   ----------------------------------------------------------
   • Optimized Performance with Spatial Indexing
   • Right-click Coordinate Retrieval
   • Simplified UI
   ========================================================== */

(function () {
    const canvas = document.getElementById('map-canvas');
    const ctx = canvas.getContext('2d', { alpha: false });
    const loader = document.getElementById('loading-screen');
    const ctxMenu = document.getElementById('ctx-menu');
    const coordsDisplay = document.getElementById('coords-display');

    // UI Sliders (Hidden but used for state)
    const sliders = {
        ox: document.getElementById('slider-ox'),
        oy: document.getElementById('slider-oy'),
        sx: document.getElementById('slider-sx'),
        sy: document.getElementById('slider-sy'),
        rot: document.getElementById('slider-rot')
    };
    const toggles = {
        photos: document.getElementById('toggle-photos')
    };

    // State
    const state = {
        viewX: 0,
        viewY: 0,
        zoom: 1.0,
        layers: {
            mapAreas: [],
            prefabs: [],
            roads: [],
            ferries: [],
            cities: [],
            pois: [],
            photos: [],
            roadNames: []
        },
        toggles: {
            photos: true,
            roadNames: true,
            background: true
        },
        calibration: {
            ox: 0, 
            oy: 0,
            sx: 45.0,  
            sy: -110.0,
            rot: 0
        },
        background: { // New background object
            image: null,
            isLoaded: false,
            centerLon: 145.5000164922681, // User provided center longitude
            centerLat: 64.40890004210075,  // User provided center latitude
            widthInMapUnits: 40,   // Arbitrary initial width in abstract map units, needs calibration
            heightInMapUnits: 30,  // Arbitrary initial height in abstract map units, needs calibration
            isVisible: true
        },
        guessing: {
            enabled: false,
            guessMarker: null, // Local player's guess
            actualMarker: null, // {lon, lat}
            showActual: false,
            playerMarkers: {} // id: {lon, lat, name}
        }
    };

    // --- API ---
    window.MapEngine = {
        setGuessingMode: (enabled) => {
            state.guessing.enabled = enabled;
            state.toggles.photos = !enabled;
            if (enabled) {
                state.guessing.guessMarker = null;
                state.guessing.actualMarker = null;
                state.guessing.showActual = false;
                state.guessing.playerMarkers = {};
            }
            requestAnimationFrame(render);
        },
        setActualLocation: (lon, lat) => {
            state.guessing.actualMarker = { lon, lat };
            state.guessing.showActual = true;
            requestAnimationFrame(render);
        },
        setPlayerGuesses: (players) => {
            Object.values(players).forEach(p => {
                if (p.currentGuess) {
                    state.guessing.playerMarkers[p.id] = {
                        lon: p.currentGuess.lon,
                        lat: p.currentGuess.lat,
                        name: p.name
                    };
                }
            });
            requestAnimationFrame(render);
        },
        clearGuess: () => {
            state.guessing.guessMarker = null;
            requestAnimationFrame(render);
        },
        getGuess: () => state.guessing.guessMarker,
        getDistance: (lon1, lat1, lon2, lat2) => {
            // Simple Euclidean distance in map units for now
            // ETS2 coordinates are roughly linear
            const dx = lon1 - lon2;
            const dy = lat1 - lat2;
            return Math.sqrt(dx*dx + dy*dy);
        },
        focusCoords: (lon, lat, zoom = 1.0) => {
            const p = transform(lon, lat);
            state.viewX = canvas.width / 2 - p.x * zoom;
            state.viewY = canvas.height / 2 - p.y * zoom;
            state.zoom = zoom;
            requestAnimationFrame(render);
        }
    };
    
    async function start() {
        if (window.FER_DATA_LOADING) await window.FER_DATA_LOADING;
        
        if (!window.FER_DATA || !window.FER_DATA.features) {
            console.error('Error: window.FER_DATA (from fer-geojson.js) failed to load or is empty. Map data is critical for proper functionality.');
            setTimeout(start, 200); // Re-try loading
            return;
        }

        // Load background image
        const bgImg = new Image();
        bgImg.src = 'imgs/mapbg.png';
        bgImg.onload = () => {
            state.background.image = bgImg;
            state.background.isLoaded = true;
            
            // Calculate dimensions to match original image size (1:1 pixel scale at zoom 1.0)
            // This prevents stretching/squishing by respecting the map's projection calibration
            if (state.calibration.sx !== 0 && state.calibration.sy !== 0) {
                const scaleFactor = 4.3; // User requested 250% size
                state.background.widthInMapUnits = (bgImg.width / state.calibration.sx) * scaleFactor;
                state.background.heightInMapUnits = (bgImg.height / Math.abs(state.calibration.sy)) * scaleFactor;
            }
            
            console.log(`Background Debug: Image loaded. Dimensions set to ${state.background.widthInMapUnits.toFixed(4)} x ${state.background.heightInMapUnits.toFixed(4)} map units.`);
            requestAnimationFrame(render); // Request a re-render once image loads
        };
        bgImg.onerror = () => {
            console.error('Background Debug: Failed to load background image: imgs/mapbg.png');
            state.background.isLoaded = false;
        };

        processData(window.FER_DATA.features);
        processMarkers();
        processRoadNames();
        initializeView();
        setupToggles();
    }

    function processMarkers() {
        if (window.USER_PHOTOS) {
            window.USER_PHOTOS.forEach(photo => {
                const feature = {
                    type: "Feature",
                    properties: { 
                        type: "photo", 
                        name: photo.name, 
                        desc: photo.desc,
                        user: photo.user,
                        photo: photo.photo 
                    },
                    geometry: { type: "Point", coordinates: [photo.lon, photo.lat] },
                    _bounds: { minX: photo.lon, maxX: photo.lon, minY: photo.lat, maxY: photo.lat }
                };
                state.layers.photos.push(feature);
            });
        }
    }

    const roadNameImages = {}; // Cache for road name images

    function processRoadNames() {
        if (window.ROAD_NAMES) {
            window.ROAD_NAMES.forEach(roadName => {
                const feature = {
                    type: "Feature",
                    properties: {
                        type: "roadName",
                        name: roadName.name,
                        image: roadName.image || null,
                        rotation: roadName.rotation || 0
                    },
                    geometry: { type: "Point", coordinates: [roadName.lon, roadName.lat] },
                    _bounds: { minX: roadName.lon, maxX: roadName.lon, minY: roadName.lat, maxY: roadName.lat }
                };
                state.layers.roadNames.push(feature);

                if (roadName.image && !roadNameImages[roadName.image]) {
                    const img = new Image();
                    img.src = roadName.image;
                    img.onload = () => requestAnimationFrame(render);
                    img.onerror = () => console.error(`Road Name: Failed to load image: ${roadName.image}`);
                    roadNameImages[roadName.image] = img;
                }
            });
        }
    }

    function setupToggles() {
        Object.keys(toggles).forEach(key => {
            if (!toggles[key]) return;
            toggles[key].onchange = (e) => {
                state.toggles[key] = e.target.checked;
                requestAnimationFrame(render);
            };
            state.toggles[key] = toggles[key].checked;
        });

        // Add the new road names toggle
        const roadNamesToggle = document.getElementById('toggle-road-names');
        if (roadNamesToggle) {
            roadNamesToggle.onchange = (e) => {
                state.toggles.roadNames = e.target.checked;
                requestAnimationFrame(render);
            };
            state.toggles.roadNames = roadNamesToggle.checked;
        }

        // Add the new background toggle
        const backgroundToggle = document.getElementById('toggle-background');
        if (backgroundToggle) {
            backgroundToggle.onchange = (e) => {
                state.toggles.background = e.target.checked;
                requestAnimationFrame(render);
            };
            state.toggles.background = backgroundToggle.checked;
        } else {
            console.error('Background Debug: HTML element with id "toggle-background" not found!');
        }
    }

    function processData(features) {
        features.forEach(feature => {
            if (!feature.geometry) return;
            const bounds = getBounds(feature.geometry);
            feature._bounds = bounds;
            
            const type = feature.properties.type;
            let layerKey = type + 's';
            if (type === 'city') layerKey = 'cities';
            else if (type === 'ferry') layerKey = 'ferries';
            else if (type === 'mapArea') layerKey = 'mapAreas';

            if (state.layers[layerKey]) {
                state.layers[layerKey].push(feature);
            }
        });
    }

    function getBounds(geometry) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        function traverse(coords) {
            if (typeof coords[0] === 'number') {
                const x = coords[0], y = coords[1];
                if (x < minX) minX = x; if (x > maxX) maxX = x;
                if (y < minY) minY = y; if (y > maxY) maxY = y;
            } else {
                for (let i = 0; i < coords.length; i++) traverse(coords[i]);
            }
        }
        traverse(geometry.coordinates);
        return { minX, minY, maxX, maxY };
    }

    function initializeView() {
        let totalMinX = Infinity, totalMaxX = -Infinity, totalMinY = Infinity, totalMaxY = -Infinity;
        Object.values(state.layers).forEach(layer => {
            layer.forEach(f => {
                // Ensure valid bounds exist before updating totals
                if (f._bounds && typeof f._bounds.minX === 'number' && isFinite(f._bounds.minX)) {
                    const b = f._bounds;
                    if (b.minX < totalMinX) totalMinX = b.minX;
                    if (b.maxX > totalMaxX) totalMaxX = b.maxX;
                    if (b.minY < totalMinY) totalMinY = b.minY;
                    if (b.maxY > totalMaxY) totalMaxY = b.maxY;
                }
            });
        });

        // Fallback if no valid map data was loaded to prevent NaN
        if (!isFinite(totalMinX) || !isFinite(totalMaxX) || !isFinite(totalMinY) || !isFinite(totalMaxY) || (totalMaxX - totalMinX === 0) || (totalMaxY - totalMinY === 0)) {
            console.warn('No valid map features found or map dimensions are zero for initialization. Using default view and calibration.');
            state.calibration.ox = 0;
            state.calibration.oy = 0;
            state.zoom = 1.0;
            state.viewX = canvas.width / 2;
            state.viewY = canvas.height / 2;
        } else {
            const cx = (totalMinX + totalMaxX) / 2;
            const cy = (totalMinY + totalMaxY) / 2;
            state.calibration.ox = -cx;
            state.calibration.oy = -cy;
            
            const widthPx = (totalMaxX - totalMinX) * state.calibration.sx;
            const heightPx = (totalMaxY - totalMinY) * Math.abs(state.calibration.sy);
            
            const zoomX = canvas.width / widthPx;
            const zoomY = canvas.height / heightPx;
            state.zoom = Math.min(zoomX, zoomY) * 0.8;
            
            state.viewX = canvas.width / 2;
            state.viewY = canvas.height / 2;
        }
        
        loader.style.opacity = '0';
        setTimeout(() => loader.style.display = 'none', 800);
        
        requestAnimationFrame(render);
    }

    // --- Interaction ---
    function resize() {
        const container = canvas.parentElement;
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
        requestAnimationFrame(render);
    }
    
    // Watch for container resize (when user hovers/expands it)
    const resizeObserver = new ResizeObserver(() => {
        resize();
    });
    resizeObserver.observe(canvas.parentElement);

    window.addEventListener('resize', resize);
    resize();

    let isDragging = false, lastX, lastY;
    canvas.onmousedown = (e) => { 
        if(e.button !== 0) return;
        isDragging = true; lastX = e.clientX; lastY = e.clientY; 
        canvas.style.cursor = 'grabbing';
    };
    window.onmouseup = () => { isDragging = false; canvas.style.cursor = 'grab'; };
    window.onmousemove = (e) => {
        if (!isDragging) return;
        state.viewX += e.clientX - lastX;
        state.viewY += e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        requestAnimationFrame(render);
    };

    canvas.onwheel = (e) => {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 0.85 : 1.15;
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        const worldX = (mouseX - state.viewX) / state.zoom;
        const worldY = (mouseY - state.viewY) / state.zoom;
        state.zoom *= factor;
        state.zoom = Math.max(0.01, Math.min(2000, state.zoom));
        state.viewX = mouseX - worldX * state.zoom;
        state.viewY = mouseY - worldY * state.zoom;
        requestAnimationFrame(render);
    };

    // Right Click for Coordinates (Disabled for cleaner game experience but kept logic)
    canvas.oncontextmenu = (e) => {
        e.preventDefault();
    };

    function getCoordsFromPixel(px, py) {
        const c = state.calibration;
        // Invert Scaling
        const rx = px / c.sx;
        const ry = py / c.sy;
        
        // Invert Rotation (simplified for rot=0)
        let tx = rx, ty = ry;
        if (c.rot !== 0) {
            const rad = -c.rot * Math.PI / 180; // Negative rotation
            const cos = Math.cos(rad), sin = Math.sin(rad);
            tx = rx * cos - ry * sin;
            ty = rx * sin + ry * cos;
        }

        // Invert Translation
        return {
            lon: tx - c.ox,
            lat: ty - c.oy
        };
    }

    canvas.onclick = (e) => {
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        if (state.guessing.enabled) {
            const worldX = (mouseX - state.viewX) / state.zoom;
            const worldY = (mouseY - state.viewY) / state.zoom;
            const coords = getCoordsFromPixel(worldX, worldY);
            state.guessing.guessMarker = coords;
            if (window.GeoGuessr) window.GeoGuessr.onMarkerPlaced(coords);
            requestAnimationFrame(render);
            return;
        }
        
        state.layers.photos.forEach(f => {
            const p = transform(f.geometry.coordinates[0], f.geometry.coordinates[1]);
            const sx = p.x * state.zoom + state.viewX;
            const sy = p.y * state.zoom + state.viewY;
            const dist = Math.sqrt((mouseX - sx)**2 + (mouseY - sy)**2);
            if (dist < 15 && state.toggles.photos) {
                // Open Photo Modal
                const modal = document.getElementById('photo-modal');
                const img = document.getElementById('modal-img');
                const title = document.getElementById('modal-title');
                const desc = document.getElementById('modal-desc');
                const user = document.getElementById('modal-user');

                img.src = f.properties.photo;
                title.innerText = f.properties.name.toUpperCase();
                desc.innerText = f.properties.desc;
                user.innerText = `BY ${f.properties.user.toUpperCase()}`;
                
                modal.style.display = 'flex';
            }
        });
    };

    // --- Rendering Core ---
    function transform(lon, lat) {
        const c = state.calibration;
        const tx = lon + c.ox, ty = lat + c.oy;
        let rx = tx, ry = ty;
        if (c.rot !== 0) {
            const rad = c.rot * Math.PI / 180;
            const cos = Math.cos(rad), sin = Math.sin(rad);
            rx = tx * cos - ty * sin; ry = tx * sin + ty * cos;
        }
        return { x: rx * c.sx, y: ry * c.sy };
    }

    function isVisible(featureBounds) {
        const p1 = transform(featureBounds.minX, featureBounds.minY);
        const p2 = transform(featureBounds.maxX, featureBounds.maxY);
        const fMinX = Math.min(p1.x, p2.x) * state.zoom + state.viewX;
        const fMaxX = Math.max(p1.x, p2.x) * state.zoom + state.viewX;
        const fMinY = Math.min(p1.y, p2.y) * state.zoom + state.viewY;
        const fMaxY = Math.max(p1.y, p2.y) * state.zoom + state.viewY;
        return !(fMaxX < 0 || fMinX > canvas.width || fMaxY < 0 || fMinY > canvas.height);
    }

    function render() {
        ctx.fillStyle = "#080808"; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.save(); ctx.translate(state.viewX, state.viewY); ctx.scale(state.zoom, state.zoom);
        const zoom = state.zoom;
        const detailLevel = zoom > 1.5 ? 2 : (zoom > 0.5 ? 1 : 0);

        // 0. Background Image
        if (state.toggles.background && state.background.isLoaded && state.background.image) {
            const bg = state.background;
            const p = transform(bg.centerLon, bg.centerLat);
            // Calculate dimensions in world pixels
            const width = bg.widthInMapUnits * state.calibration.sx;
            // Use absolute value for height scaling as sy is negative
            const height = bg.heightInMapUnits * Math.abs(state.calibration.sy);
            
            ctx.drawImage(
                bg.image,
                p.x - width / 2,
                p.y - height / 2,
                width,
                height
            );
        }

        // 1. Map Areas
        const areaColors = { 0: "#1a1a1a", 1: "#1e272e", 2: "#2d3436", 3: "#000000", 4: "#218c74" };
        state.layers.mapAreas.sort((a,b) => (a.properties.zIndex || 0) - (b.properties.zIndex || 0));
        state.layers.mapAreas.forEach(f => {
            if (!isVisible(f._bounds)) return;
            ctx.fillStyle = areaColors[f.properties.color] || areaColors[0];
            ctx.strokeStyle = "#222"; ctx.lineWidth = 0.5 / zoom;
            ctx.beginPath(); drawGeometry(f.geometry); ctx.fill(); ctx.stroke();
        });

        // 2. Prefabs
        const prefabColors = { 0: "#2c3e50", 1: "#34495e", 2: "#57606f", 3: "#a4b0be", 4: "#e67e22" };
        state.layers.prefabs.sort((a,b) => (a.properties.zIndex || 0) - (b.properties.zIndex || 0));
        state.layers.prefabs.forEach(f => {
            if (!isVisible(f._bounds)) return;
            const isHouse = f.properties.color === 2 || f.properties.color === 3;
            ctx.fillStyle = prefabColors[f.properties.color] || prefabColors[1];
            ctx.strokeStyle = isHouse ? "#2f3542" : "#333"; ctx.lineWidth = (isHouse ? 1.2 : 0.8) / zoom;
            ctx.beginPath(); drawGeometry(f.geometry); ctx.fill(); ctx.stroke();
            if (isHouse && zoom > 0.5) { ctx.strokeStyle = "rgba(255,255,255,0.1)"; ctx.lineWidth = 0.5 / zoom; ctx.stroke(); }
        });

        // 3. Roads
        const drawRoadBatch = (isSecret, color, width) => {
            ctx.beginPath();
            state.layers.roads.forEach(f => {
                if (f.properties.secret !== isSecret) return;
                if (detailLevel === 0 && f.properties.roadType === 'local') return;
                if (!isVisible(f._bounds)) return;
                drawGeometry(f.geometry);
            });
            ctx.strokeStyle = color; ctx.lineWidth = width / zoom; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.stroke();
        };
        drawRoadBatch(false, "#e1b12c", detailLevel === 0 ? 3 : 1.5);
        drawRoadBatch(true, "#ffffff", detailLevel === 0 ? 4 : 2);

        // 4. Ferries
        ctx.beginPath();
        state.layers.ferries.forEach(f => { if (!isVisible(f._bounds)) return; drawGeometry(f.geometry); });
        ctx.strokeStyle = "#4aa3df"; ctx.lineWidth = (detailLevel === 0 ? 4 : 2) / zoom;
        ctx.setLineDash([8/zoom, 4/zoom]); ctx.stroke(); ctx.setLineDash([]);

        // 5. POIs (Ferry Ports)
        state.layers.pois.forEach(f => {
            if (!isVisible(f._bounds)) return;
            const p = transform(f.geometry.coordinates[0], f.geometry.coordinates[1]);
            if (f.properties.poiType === 'ferry') {
                const size = 7 / zoom; ctx.fillStyle = "#3498db"; ctx.strokeStyle = "#2980b9"; ctx.lineWidth = 2 / zoom;
                ctx.beginPath(); ctx.arc(p.x, p.y, size/2, 0, Math.PI*2); ctx.fill(); ctx.stroke();
                if (zoom > 0.5) { ctx.font = `italic bold ${10/zoom}px sans-serif`; ctx.fillStyle = "#3498db"; ctx.fillText("FERRY: " + (f.properties.poiName || ""), p.x, p.y + 12/zoom); }
            }
        });

        // 6. User Photos
        if (state.toggles.photos) {
            state.layers.photos.forEach(f => {
                if (!isVisible(f._bounds)) return;
                const p = transform(f.geometry.coordinates[0], f.geometry.coordinates[1]);
                const size = 8 / zoom;
                ctx.fillStyle = "#27ae60"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5 / zoom;
                ctx.beginPath(); ctx.moveTo(p.x - size/2, p.y - size/2); ctx.lineTo(p.x + size/2, p.y - size/2); ctx.lineTo(p.x + size/2, p.y + size/2); ctx.lineTo(p.x - size/2, p.y + size/2); ctx.closePath(); ctx.fill(); ctx.stroke();
                if (zoom > 1.0) { ctx.font = `bold ${9/zoom}px sans-serif`; ctx.fillStyle = "#2ecc71"; ctx.fillText(f.properties.name, p.x, p.y + 12/zoom); }
            });
        }

        // 7. Road Names
        if (state.toggles.roadNames) {
            state.layers.roadNames.forEach(f => {
                if (!isVisible(f._bounds)) return;
                const p = transform(f.geometry.coordinates[0], f.geometry.coordinates[1]);
                
                ctx.save();
                ctx.translate(p.x, p.y);
                if (f.properties.rotation) {
                    ctx.rotate(f.properties.rotation * Math.PI / 180);
                }

                if (f.properties.image && roadNameImages[f.properties.image] && roadNameImages[f.properties.image].complete) {
                    const img = roadNameImages[f.properties.image];
                    const imgWidth = img.width / (zoom * 2); // Default image size
                    const imgHeight = img.height / (zoom * 2); // Default image size
                    ctx.drawImage(img, -imgWidth / 2, -imgHeight / 2, imgWidth, imgHeight);
                } else if (f.properties.name) {
                    ctx.font = `bold ${12/zoom}px sans-serif`; // Default font size
                    ctx.fillStyle = "#fff";
                    ctx.strokeStyle = "#000";
                    ctx.lineWidth = 2 / zoom;
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.strokeText(f.properties.name, 0, 0);
                    ctx.fillText(f.properties.name, 0, 0);
                }
                ctx.restore();
            });
        }

        // 8. Cities
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        state.layers.cities.forEach(f => {
            if (!isVisible(f._bounds)) return;
            const p = transform(f.geometry.coordinates[0], f.geometry.coordinates[1]);
            ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(p.x, p.y, 4 / zoom, 0, Math.PI*2); ctx.fill();
            if (zoom > 0.05) {
                ctx.save(); ctx.font = `bold ${13/zoom}px sans-serif`; ctx.fillStyle = "#fff"; ctx.strokeStyle = "#000"; ctx.lineWidth = 4 / zoom;
                ctx.strokeText(f.properties.name.toUpperCase(), p.x, p.y - 12/zoom); ctx.fillText(f.properties.name.toUpperCase(), p.x, p.y - 12/zoom); ctx.restore();
            }
        });

        // 9. Guess Markers
        if (state.guessing.enabled) {
            // Draw current local guess
            if (state.guessing.guessMarker) {
                const p = transform(state.guessing.guessMarker.lon, state.guessing.guessMarker.lat);
                const size = 15 / zoom;
                ctx.fillStyle = "#e74c3c"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2 / zoom;
                ctx.beginPath(); 
                ctx.moveTo(p.x, p.y - size); 
                ctx.lineTo(p.x - size/2, p.y - size/2); 
                ctx.lineTo(p.x, p.y); 
                ctx.lineTo(p.x + size/2, p.y - size/2); 
                ctx.closePath(); 
                ctx.fill(); ctx.stroke();
            }

            // Draw all other player markers if in results mode
            if (state.guessing.showActual) {
                Object.values(state.guessing.playerMarkers).forEach(m => {
                    const p = transform(m.lon, m.lat);
                    const size = 10 / zoom;
                    ctx.fillStyle = "rgba(231, 76, 60, 0.7)"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 1 / zoom;
                    ctx.beginPath(); ctx.arc(p.x, p.y, size/2, 0, Math.PI*2); ctx.fill(); ctx.stroke();
                    
                    if (zoom > 0.5) {
                        ctx.font = `bold ${8/zoom}px sans-serif`;
                        ctx.fillStyle = "#fff";
                        ctx.textAlign = "center";
                        ctx.fillText(m.name, p.x, p.y + 12/zoom);
                    }

                    // Draw line to actual if showing results
                    if (state.guessing.actualMarker) {
                        const actual = transform(state.guessing.actualMarker.lon, state.guessing.actualMarker.lat);
                        ctx.beginPath();
                        ctx.moveTo(p.x, p.y);
                        ctx.lineTo(actual.x, actual.y);
                        ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
                        ctx.lineWidth = 1 / zoom;
                        ctx.stroke();
                    }
                });
            }

            if (state.guessing.showActual && state.guessing.actualMarker) {
                const actual = transform(state.guessing.actualMarker.lon, state.guessing.actualMarker.lat);
                const size = 12 / zoom;
                ctx.fillStyle = "#27ae60"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2 / zoom;
                ctx.beginPath(); ctx.arc(actual.x, actual.y, size/2, 0, Math.PI*2); ctx.fill(); ctx.stroke();
            }
        }

        ctx.restore();
    }

    function drawGeometry(geom) {
        if (geom.type === 'Point') return;
        const coords = geom.coordinates;
        if (geom.type === 'LineString') drawLine(coords);
        else if (geom.type === 'Polygon') coords.forEach(ring => drawLine(ring, true));
        else if (geom.type === 'MultiPolygon') coords.forEach(poly => poly.forEach(ring => drawLine(ring, true)));
    }

    function drawLine(points, closed=false) {
        if(points.length < 2) return;
        const p0 = transform(points[0][0], points[0][1]); ctx.moveTo(p0.x, p0.y);
        for (let i = 1; i < points.length; i++) { const p = transform(points[i][0], points[i][1]); ctx.lineTo(p.x, p.y); }
        if (closed) ctx.closePath();
    }

    start();
})();
