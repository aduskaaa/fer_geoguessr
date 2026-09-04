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
        currentVersion: 'V1',
        layers: {
            mapAreas: [],
            prefabs: [],
            roads: [],
            ferries: [],
            cities: [],
            pois: [],
            photos: [],
            streetview: []
        },
        toggles: {
            photos: true,
            background: true
        },
        calibration: {
            ox: 0,
            oy: 0,
            sx: 45.0,
            sy: -110.0,
            rot: 0
        },
        background: {
            image: null,
            isLoaded: false,
            centerLon: 105.0,
            centerLat: 61.0,
            widthInMapUnits: 170.0,
            heightInMapUnits: 42.0,
            isVisible: true
        },
        minZoom: 0.05,
        maxZoom: 2000,
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
        setMapVersion: (version) => {
            setMapVersionInternal(version);
        },
        getMapVersion: () => state.currentVersion || 'V1',
        setGuessingMode: (enabled) => {
            state.guessing.enabled = enabled;
            state.toggles.photos = !enabled;
            requestAnimationFrame(render);
        },
        isGuessingMode: () => state.guessing.enabled,
        initRound: () => {
            state.guessing.guessMarker = null;
            state.guessing.actualMarker = null;
            state.guessing.showActual = false;
            state.guessing.playerMarkers = {};
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
            return Math.sqrt(dx * dx + dy * dy);
        },
        getHaversineDistance: (lat1, lon1, lat2, lon2) => {
            const R = 6371; // km
            const dLat = (lat2 - lat1) * Math.PI / 180;
            const dLon = (lon2 - lon1) * Math.PI / 180;
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2);
            return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        },
        getStreetViewData: (index) => state.layers.streetview[index],
        findBestStreetViewOptions: (svId, currentLon, currentLat, currentRotation) => {
            const pCenter = transform(currentLon, currentLat);

            // Compute actual visual orientation based on sequence
            let actualTruckRotation = currentRotation;
            let nextSV = state.layers.streetview.find(s => s.properties.id === svId + 1);
            if (!nextSV) nextSV = state.layers.streetview.find(s => s.properties.id === svId - 1);
            if (nextSV) {
                const pNext = transform(nextSV.geometry.coordinates[0], nextSV.geometry.coordinates[1]);
                let dy = pNext.y - pCenter.y;
                let dx = pNext.x - pCenter.x;
                actualTruckRotation = Math.atan2(dx, -dy);
                if (nextSV.properties.id === svId - 1) actualTruckRotation += Math.PI;
            }

            let targetTaRotation = currentRotation + Math.PI;
            if (targetTaRotation > 2 * Math.PI) targetTaRotation -= 2 * Math.PI;

            let taBestIndex = -1;
            let taMinDiff = Infinity;

            let bestOptions = {
                forward: { index: -1, score: -Infinity, angle: 0 },
                left: { index: -1, score: -Infinity, angle: 0 },
                right: { index: -1, score: -Infinity, angle: 0 },
                backward: { index: -1, score: -Infinity, angle: 0 }
            };

            state.layers.streetview.forEach((sv, index) => {
                const svIdTarget = sv.properties.id;
                if (svIdTarget === svId) return;

                const svLon = sv.geometry.coordinates[0];
                const svLat = sv.geometry.coordinates[1];

                if (Math.abs(svLon - currentLon) < 0.00001 && Math.abs(svLat - currentLat) < 0.00001) return;

                const distance = window.MapEngine.getHaversineDistance(currentLat, currentLon, svLat, svLon);

                // Movement constraints
                const isSequence = Math.abs(svIdTarget - svId) === 1;
                if (!isSequence && distance > 0.8) return;
                if (isSequence && distance > 10.0) return;

                const targetRotation = sv.properties.truck_rotation * Math.PI * 2;

                // Turn around logic
                if (distance < 0.8) {
                    const rotationDiff = Math.abs(targetRotation - targetTaRotation);
                    const normalizedRotationDiff = Math.min(rotationDiff, 2 * Math.PI - rotationDiff);
                    if (normalizedRotationDiff < taMinDiff && normalizedRotationDiff < Math.PI / 2) {
                        taMinDiff = normalizedRotationDiff;
                        taBestIndex = index;
                    }
                }

                // Bearings calculate strictly on the visual Canvas plane
                const pTarget = transform(svLon, svLat);
                let tdy = pTarget.y - pCenter.y;
                let tdx = pTarget.x - pCenter.x;
                let bearing = Math.atan2(tdx, -tdy);
                if (bearing < 0) bearing += 2 * Math.PI;

                let relativeAngle = bearing - actualTruckRotation;
                if (relativeAngle > Math.PI) relativeAngle -= 2 * Math.PI;
                if (relativeAngle < -Math.PI) relativeAngle += 2 * Math.PI;

                let rotDiff = targetRotation - currentRotation;
                if (rotDiff > Math.PI) rotDiff -= 2 * Math.PI;
                if (rotDiff < -Math.PI) rotDiff += 2 * Math.PI;
                const absRotDiff = Math.abs(rotDiff);

                if (svIdTarget === svId + 1) {
                    bestOptions.forward = { index, score: Infinity, angle: relativeAngle };
                    return;
                }
                if (svIdTarget === svId - 1) {
                    bestOptions.backward = { index, score: Infinity, angle: relativeAngle };
                    return;
                }

                let score = - (distance * 1000);
                if (Math.abs(relativeAngle) < Math.PI / 3) {
                    if (absRotDiff < Math.PI / 2) {
                        let fScore = score - absRotDiff * 10;
                        if (fScore > bestOptions.forward.score) {
                            bestOptions.forward = { index, score: fScore, angle: relativeAngle };
                        }
                    }
                } else if (relativeAngle >= Math.PI / 3 && relativeAngle <= 2 * Math.PI / 3) {
                    if (score > bestOptions.right.score) {
                        bestOptions.right = { index, score, angle: relativeAngle };
                    }
                } else if (relativeAngle <= -Math.PI / 3 && relativeAngle >= -2 * Math.PI / 3) {
                    if (score > bestOptions.left.score) {
                        bestOptions.left = { index, score, angle: relativeAngle };
                    }
                } else if (Math.abs(relativeAngle) > 2 * Math.PI / 3) {
                    if (absRotDiff < Math.PI / 2) {
                        let bScore = score - absRotDiff * 10;
                        if (bScore > bestOptions.backward.score) {
                            bestOptions.backward = { index, score: bScore, angle: relativeAngle };
                        }
                    }
                }
            });

            return { bestOptions, taBestIndex };
        },
        focusCoords: (lon, lat, zoom = 1.0) => {
            const p = transform(lon, lat);
            state.viewX = canvas.width / 2 - p.x * zoom;
            state.viewY = canvas.height / 2 - p.y * zoom;
            state.zoom = zoom;
            requestAnimationFrame(render);
        }
    };

    function setMapVersionInternal(version) {
        const v = (version || 'V1').toUpperCase();
        state.currentVersion = v;

        // Clear existing dynamic layers
        state.layers.mapAreas = [];
        state.layers.prefabs = [];
        state.layers.roads = [];
        state.layers.ferries = [];
        state.layers.cities = [];
        state.layers.pois = [];
        state.layers.photos = [];
        state.layers.streetview = [];

        // Pick data corresponding to requested version
        let geoData = (v === 'V2' && window.FER_DATA_V2) ? window.FER_DATA_V2 : (window.FER_DATA_V1 || window.FER_DATA);
        let svData = (v === 'V2' && window.streetview_data_v2) ? window.streetview_data_v2 : (window.streetview_data_v1 || window.streetview_data);

        if (geoData && geoData.features) {
            processData(geoData.features);
        }
        processMarkers();
        if (svData) {
            processStreetView(svData);
        }

        initializeView();
        requestAnimationFrame(render);
    }

    async function start() {
        if (window.FER_DATA_LOADING) await window.FER_DATA_LOADING;

        const dataReady = window.FER_DATA_V1 || window.FER_DATA || window.FER_DATA_V2;
        if (!dataReady || !dataReady.features) {
            console.warn('Map data not ready yet, retrying...');
            setTimeout(start, 200); // Re-try loading
            return;
        }

        // Load background image from main repo (WebP, fallback PNG)
        const bgImg = new Image();
        bgImg.src = 'imgs/mapbg_russia.webp';
        bgImg.onload = () => {
            state.background.image = bgImg;
            state.background.isLoaded = true;
            state.background.centerLon = 105.0;
            state.background.centerLat = 61.0;
            state.background.widthInMapUnits = 170.0;
            state.background.heightInMapUnits = 42.0;
            clampView();
            requestAnimationFrame(render);
        };
        bgImg.onerror = () => {
            const fallbackImg = new Image();
            fallbackImg.src = 'imgs/mapbg.png';
            fallbackImg.onload = () => {
                state.background.image = fallbackImg;
                state.background.isLoaded = true;
                state.background.centerLon = 105.0;
                state.background.centerLat = 61.0;
                state.background.widthInMapUnits = 170.0;
                state.background.heightInMapUnits = 42.0;
                clampView();
                requestAnimationFrame(render);
            };
            fallbackImg.onerror = () => {
                console.error('Failed to load background image');
                state.background.isLoaded = false;
            };
        };

        const initialVersion = window.MAP_VERSION || 'V1';
        setMapVersionInternal(initialVersion);
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

    function processStreetView(data) {
        const source = data || (state.currentVersion === 'V2' && window.streetview_data_v2 ? window.streetview_data_v2 : (window.streetview_data_v1 || window.streetview_data));
        if (source) {
            source.forEach(sv => {
                const feature = {
                    type: "Feature",
                    properties: {
                        type: "streetview",
                        id: sv.id,
                        file: sv.file,
                        truck_rotation: sv.truck_rotation
                    },
                    geometry: { type: "Point", coordinates: [sv.lon, sv.lat] },
                    _bounds: { minX: sv.lon, maxX: sv.lon, minY: sv.lat, maxY: sv.lat }
                };
                state.layers.streetview.push(feature);
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

        const backgroundToggle = document.getElementById('toggle-background');
        if (backgroundToggle) {
            backgroundToggle.onchange = (e) => {
                state.toggles.background = e.target.checked;
                requestAnimationFrame(render);
            };
            state.toggles.background = backgroundToggle.checked;
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

            updateMinZoom();
            if (state.zoom < state.minZoom) state.zoom = state.minZoom;
            clampView();
        }

        if (loader) {
            loader.style.opacity = '0';
            setTimeout(() => loader.style.display = 'none', 800);
        }

        requestAnimationFrame(render);
    }

    // --- Interaction & View Clamping ---
    function updateMinZoom() {
        const bg = state.background;
        if (bg.isLoaded && bg.widthInMapUnits > 0 && bg.heightInMapUnits > 0 && canvas.width > 0 && canvas.height > 0) {
            const bgW = bg.widthInMapUnits * state.calibration.sx;
            const bgH = bg.heightInMapUnits * Math.abs(state.calibration.sy);
            // Clamps minZoom so the canvas never zooms out smaller than the background image
            state.minZoom = Math.max(canvas.width / bgW, canvas.height / bgH);
        } else {
            state.minZoom = 0.05;
        }
    }

    function clampView() {
        updateMinZoom();
        state.zoom = Math.max(state.minZoom, Math.min(state.maxZoom || 2000, state.zoom));

        const bg = state.background;
        if (!bg.isLoaded) return;

        const p = transform(bg.centerLon, bg.centerLat);
        const w = bg.widthInMapUnits * state.calibration.sx;
        const h = bg.heightInMapUnits * Math.abs(state.calibration.sy);
        const b = { minX: p.x - w / 2, maxX: p.x + w / 2, minY: p.y - h / 2, maxY: p.y + h / 2 };
        const z = state.zoom;

        const minViewX = canvas.width - b.maxX * z;
        const maxViewX = -b.minX * z;
        if (minViewX > maxViewX) {
            state.viewX = (minViewX + maxViewX) / 2;
        } else {
            state.viewX = Math.max(minViewX, Math.min(maxViewX, state.viewX));
        }

        const minViewY = canvas.height - b.maxY * z;
        const maxViewY = -b.minY * z;
        if (minViewY > maxViewY) {
            state.viewY = (minViewY + maxViewY) / 2;
        } else {
            state.viewY = Math.max(minViewY, Math.min(maxViewY, state.viewY));
        }
    }

    function resize() {
        const container = canvas.parentElement;
        if (!container) return;
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
        clampView();
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
        if (e.button !== 0) return;
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
        clampView();
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

        updateMinZoom();
        state.zoom = Math.max(state.minZoom, Math.min(state.maxZoom || 2000, state.zoom * factor));
        state.viewX = mouseX - worldX * state.zoom;
        state.viewY = mouseY - worldY * state.zoom;
        clampView();
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
            // BUG FIX: Prevent placing markers if already guessed
            if (window.GeoGuessr && !window.GeoGuessr.canPlaceMarker()) return;

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
            const dist = Math.sqrt((mouseX - sx) ** 2 + (mouseY - sy) ** 2);
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
        ctx.fillStyle = "#0c131d"; ctx.fillRect(0, 0, canvas.width, canvas.height);
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
        state.layers.mapAreas.sort((a, b) => (a.properties.zIndex || 0) - (b.properties.zIndex || 0));
        state.layers.mapAreas.forEach(f => {
            if (!isVisible(f._bounds)) return;
            ctx.fillStyle = areaColors[f.properties.color] || areaColors[0];
            ctx.strokeStyle = "#222"; ctx.lineWidth = 0.5 / zoom;
            ctx.beginPath(); drawGeometry(f.geometry); ctx.fill(); ctx.stroke();
        });

        // 2. Prefabs
        const prefabColors = { 0: "#2c3e50", 1: "#34495e", 2: "#57606f", 3: "#a4b0be", 4: "#e67e22" };
        state.layers.prefabs.sort((a, b) => (a.properties.zIndex || 0) - (b.properties.zIndex || 0));
        state.layers.prefabs.forEach(f => {
            if (!isVisible(f._bounds)) return;
            const isHouse = f.properties.color === 2 || f.properties.color === 3;
            ctx.fillStyle = prefabColors[f.properties.color] || prefabColors[1];
            ctx.strokeStyle = isHouse ? "#2f3542" : "#333"; ctx.lineWidth = (isHouse ? 1.2 : 0.8) / zoom;
            ctx.beginPath(); drawGeometry(f.geometry); ctx.fill(); ctx.stroke();
            if (isHouse && zoom > 0.5) { ctx.strokeStyle = "rgba(255,255,255,0.1)"; ctx.lineWidth = 0.5 / zoom; ctx.stroke(); }
        });

        // 3. Roads (Passes matching main repo style)
        ctx.lineCap = "round"; ctx.lineJoin = "round";
        const regularRoads = [];
        const secretRoads = [];
        for (let i = 0; i < state.layers.roads.length; i++) {
            const f = state.layers.roads[i];
            if (!isVisible(f._bounds)) continue;
            if (f.properties && f.properties.secret) secretRoads.push(f);
            else regularRoads.push(f);
        }

        // Pass A: Road Casings
        // 1. Secret Road Outer Dark Border + Tan Base
        if (secretRoads.length > 0) {
            ctx.beginPath();
            secretRoads.forEach(f => drawGeometry(f.geometry));
            ctx.strokeStyle = "#090a0f"; ctx.lineWidth = (detailLevel === 0 ? 7.2 : 5.0) / zoom; ctx.stroke();

            ctx.beginPath();
            secretRoads.forEach(f => drawGeometry(f.geometry));
            ctx.strokeStyle = "#d4a373"; ctx.lineWidth = (detailLevel === 0 ? 5.4 : 3.8) / zoom; ctx.stroke();
        }

        // 2. Regular Roads Orange Outline
        if (regularRoads.length > 0) {
            ctx.beginPath();
            regularRoads.forEach(f => drawGeometry(f.geometry));
            ctx.strokeStyle = "#ea580c"; ctx.lineWidth = (detailLevel === 0 ? 7.2 : 5.0) / zoom; ctx.stroke();
        }

        // Pass B: Road Fills
        // 1. Regular Roads Yellow Core
        if (regularRoads.length > 0) {
            ctx.beginPath();
            regularRoads.forEach(f => drawGeometry(f.geometry));
            ctx.strokeStyle = "#facc15"; ctx.lineWidth = (detailLevel === 0 ? 4.8 : 3.2) / zoom; ctx.stroke();
        }

        // 2. Secret Roads Brown Dashes
        if (secretRoads.length > 0) {
            ctx.beginPath();
            secretRoads.forEach(f => drawGeometry(f.geometry));
            ctx.strokeStyle = "#5c3a21"; ctx.lineWidth = (detailLevel === 0 ? 3.2 : 2.2) / zoom;
            ctx.setLineDash([7 / zoom, 4.5 / zoom]); ctx.stroke(); ctx.setLineDash([]);
        }

        // 4. Ferries
        const visibleFerries = state.layers.ferries.filter(f => isVisible(f._bounds));
        if (visibleFerries.length > 0) {
            ctx.beginPath();
            visibleFerries.forEach(f => drawGeometry(f.geometry));
            ctx.strokeStyle = "#0284c7"; ctx.lineWidth = (detailLevel === 0 ? 4.2 : 2.8) / zoom;
            ctx.setLineDash([8 / zoom, 5 / zoom]); ctx.stroke(); ctx.setLineDash([]);
        }

        // 5. POIs (Ferry Ports)
        state.layers.pois.forEach(f => {
            if (!isVisible(f._bounds)) return;
            const p = transform(f.geometry.coordinates[0], f.geometry.coordinates[1]);
            if (f.properties.poiType === 'ferry') {
                const size = 7 / zoom; ctx.fillStyle = "#3498db"; ctx.strokeStyle = "#2980b9"; ctx.lineWidth = 2 / zoom;
                ctx.beginPath(); ctx.arc(p.x, p.y, size / 2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                if (zoom > 0.5) { ctx.font = `italic bold ${10 / zoom}px sans-serif`; ctx.fillStyle = "#3498db"; ctx.fillText("FERRY: " + (f.properties.poiName || ""), p.x, p.y + 12 / zoom); }
            }
        });

        // 6. User Photos
        if (state.toggles.photos) {
            state.layers.photos.forEach(f => {
                if (!isVisible(f._bounds)) return;
                const p = transform(f.geometry.coordinates[0], f.geometry.coordinates[1]);
                const size = 8 / zoom;
                ctx.fillStyle = "#27ae60"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5 / zoom;
                ctx.beginPath(); ctx.moveTo(p.x - size / 2, p.y - size / 2); ctx.lineTo(p.x + size / 2, p.y - size / 2); ctx.lineTo(p.x + size / 2, p.y + size / 2); ctx.lineTo(p.x - size / 2, p.y + size / 2); ctx.closePath(); ctx.fill(); ctx.stroke();
                if (zoom > 1.0) { ctx.font = `bold ${9 / zoom}px sans-serif`; ctx.fillStyle = "#2ecc71"; ctx.fillText(f.properties.name, p.x, p.y + 12 / zoom); }
            });
        }

        // 7. Cities
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        state.layers.cities.forEach(f => {
            if (!isVisible(f._bounds)) return;
            const p = transform(f.geometry.coordinates[0], f.geometry.coordinates[1]);
            // City Marker: Outer White Ring + Red Center Bullseye
            ctx.fillStyle = "#ffffff"; ctx.strokeStyle = "#000000"; ctx.lineWidth = 1.5 / zoom;
            ctx.beginPath(); ctx.arc(p.x, p.y, 4.5 / zoom, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            ctx.fillStyle = "#ef4444"; ctx.beginPath(); ctx.arc(p.x, p.y, 2.2 / zoom, 0, Math.PI * 2); ctx.fill();

            if (zoom > 0.05) {
                ctx.save();
                ctx.font = `bold ${12 / zoom}px 'JetBrains Mono', ui-monospace, sans-serif`;
                ctx.fillStyle = "#ffffff"; ctx.strokeStyle = "rgba(0, 0, 0, 0.95)"; ctx.lineWidth = 4 / zoom;
                ctx.strokeText(f.properties.name.toUpperCase(), p.x, p.y - 12 / zoom);
                ctx.fillText(f.properties.name.toUpperCase(), p.x, p.y - 12 / zoom);
                ctx.restore();
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
                ctx.lineTo(p.x - size / 2, p.y - size / 2);
                ctx.lineTo(p.x, p.y);
                ctx.lineTo(p.x + size / 2, p.y - size / 2);
                ctx.closePath();
                ctx.fill(); ctx.stroke();
            }

            // Draw all other player markers if in results mode
            if (state.guessing.showActual) {
                Object.values(state.guessing.playerMarkers).forEach(m => {
                    const p = transform(m.lon, m.lat);
                    const size = 10 / zoom;
                    ctx.fillStyle = "rgba(231, 76, 60, 0.7)"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 1 / zoom;
                    ctx.beginPath(); ctx.arc(p.x, p.y, size / 2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

                    if (zoom > 0.5) {
                        ctx.font = `bold ${8 / zoom}px sans-serif`;
                        ctx.fillStyle = "#fff";
                        ctx.textAlign = "center";
                        ctx.fillText(m.name, p.x, p.y + 12 / zoom);
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
                ctx.beginPath(); ctx.arc(actual.x, actual.y, size / 2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
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

    function drawLine(points, closed = false) {
        if (points.length < 2) return;
        const p0 = transform(points[0][0], points[0][1]); ctx.moveTo(p0.x, p0.y);
        for (let i = 1; i < points.length; i++) { const p = transform(points[i][0], points[i][1]); ctx.lineTo(p.x, p.y); }
        if (closed) ctx.closePath();
    }

    start();
})();
