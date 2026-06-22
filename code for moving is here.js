/* ==========================================================
   Far East Russia – Optimized Canvas Map Engine
   ----------------------------------------------------------
   • Optimized Performance with Spatial Indexing
   • Right-click Coordinate Retrieval
   • Simplified UI
   ========================================================== */
function processStreetView() {
    if (window.streetview_data) {
        window.streetview_data.forEach(sv => {
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
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight - 62;
    requestAnimationFrame(render);
}
window.addEventListener('resize', resize);
resize();

let isDragging = false, lastX, lastY;
canvas.onmousedown = (e) => {
    if (e.button !== 0) return;
    isDragging = true; lastX = e.clientX; lastY = e.clientY;
    canvas.style.cursor = 'grabbing';
    ctxMenu.style.display = 'none';
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
    const mouseX = e.clientX;
    const mouseY = e.clientY - 62;
    const worldX = (mouseX - state.viewX) / state.zoom;
    const worldY = (mouseY - state.viewY) / state.zoom;
    state.zoom *= factor;
    state.zoom = Math.max(0.01, Math.min(2000, state.zoom));
    state.viewX = mouseX - worldX * state.zoom;
    state.viewY = mouseY - worldY * state.zoom;
    requestAnimationFrame(render);
};

// Right Click for Coordinates
canvas.oncontextmenu = (e) => {
    e.preventDefault();
    const mouseX = e.clientX;
    const mouseY = e.clientY - 62;

    // Convert screen pixel to map Lon/Lat
    const worldX = (mouseX - state.viewX) / state.zoom;
    const worldY = (mouseY - state.viewY) / state.zoom;

    const coords = getCoordsFromPixel(worldX, worldY);

    ctxMenu.style.left = mouseX + 'px';
    ctxMenu.style.top = mouseY + 'px';
    ctxMenu.style.display = 'block';

    coordsDisplay.innerHTML = `Lon: ${coords.lon.toFixed(5)}<br>Lat: ${coords.lat.toFixed(5)}`;
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

// Haversine formula to calculate distance between two points on a sphere
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of Earth in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const d = R * c; // Distance in km
    return d;
}

canvas.onclick = (e) => {
    const mouseX = e.clientX;
    const mouseY = e.clientY - 62;
    ctxMenu.style.display = 'none';

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
            return; // Prevent streetview modal from opening
        }
    });

    if (state.toggles.streetview) {
        state.layers.streetview.forEach((f, index) => {
            const p = transform(f.geometry.coordinates[0], f.geometry.coordinates[1]);
            const sx = p.x * state.zoom + state.viewX;
            const sy = p.y * state.zoom + state.viewY;
            const dist = Math.sqrt((mouseX - sx) ** 2 + (mouseY - sy) ** 2);
            if (dist < 15) {
                openStreetViewModal(index);
                return; // Prevent further clicks
            }
        });
    }
};

let currentStreetViewIndex = 0;
const streetviewModal = document.getElementById('streetview-modal');
const modalStreetViewImg = document.getElementById('modal-streetview-img');
const streetviewTurnAroundBtn = document.getElementById('streetview-turn-around');
const streetviewArrowsOverlay = document.getElementById('streetview-arrows-overlay');
const svHudSubtitle = document.getElementById('sv-hud-subtitle');
const minimapCanvas = document.getElementById('sv-minimap');
let minimapCtx = minimapCanvas ? minimapCanvas.getContext('2d') : null;

function openStreetViewModal(index) {
    currentStreetViewIndex = index;
    updateStreetViewModal();
    streetviewModal.style.display = 'block';
    setTimeout(() => resizeMinimap(), 100);

    // Bind parallax tracking uniquely once
    if (!streetviewModal.parallaxBound) {
        streetviewModal.parallaxBound = true;
        streetviewModal.addEventListener('mousemove', (e) => {
            if (streetviewModal.style.display === 'none') return;
            const rect = streetviewModal.getBoundingClientRect();
            const x = (e.clientX - rect.left) / rect.width - 0.5; // -0.5 to 0.5
            const y = (e.clientY - rect.top) / rect.height - 0.5;

            // Add a subtle inverted pan and zoom to the background image
            modalStreetViewImg.style.transform = `scale(1.15) translate(${x * -35}px, ${y * -20}px)`;

            // Add a sweeping perspective shift to the navigation cluster and paths
            const overlay = document.getElementById('streetview-arrows-overlay');
            if (overlay && overlay.firstChild) {
                overlay.firstChild.style.transform = `translateX(calc(-50% + ${x * -40}px)) perspective(600px) rotateX(70deg) rotateZ(${x * 15}deg) rotateY(${x * -25}deg)`;
            }
        });
    }
}

function updateStreetViewModal() {
    if (streetviewArrowsOverlay) streetviewArrowsOverlay.innerHTML = '';
    const currentSV = state.layers.streetview[currentStreetViewIndex];
    if (!currentSV) return;

    // Smooth fade out
    modalStreetViewImg.style.opacity = 0;
    setTimeout(() => {
        modalStreetViewImg.onload = () => {
            modalStreetViewImg.style.opacity = 1;
        };
        modalStreetViewImg.src = `imgs/streetview/${currentSV.properties.file}`;
        if (modalStreetViewImg.complete) {
            modalStreetViewImg.onload();
        }
    }, 150);

    if (svHudSubtitle) {
        svHudSubtitle.innerText = `Lat: ${currentSV.geometry.coordinates[1].toFixed(5)} • Lon: ${currentSV.geometry.coordinates[0].toFixed(5)}`;
    }

    const currentLon = currentSV.geometry.coordinates[0];
    const currentLat = currentSV.geometry.coordinates[1];
    let currentRotation = currentSV.properties.truck_rotation * Math.PI * 2;

    const searchRadiusKm = 10.0;
    const coordsTolerance = 0.01;

    let targetTaRotation = currentRotation + Math.PI;
    if (targetTaRotation > 2 * Math.PI) targetTaRotation -= 2 * Math.PI;

    const currentId = currentSV.properties.id;

    // Compute true visual angle by looking at the next road point on the canvas!
    const pCenter = transform(currentLon, currentLat);
    let actualTruckRotation = currentRotation; // fallback
    let nextSV = state.layers.streetview.find(s => s.properties.id === currentId + 1);
    if (!nextSV) nextSV = state.layers.streetview.find(s => s.properties.id === currentId - 1);
    if (nextSV) {
        const pNext = transform(nextSV.geometry.coordinates[0], nextSV.geometry.coordinates[1]);
        let dy = pNext.y - pCenter.y;
        let dx = pNext.x - pCenter.x;
        actualTruckRotation = Math.atan2(dx, -dy);
        if (nextSV.properties.id === currentId - 1) actualTruckRotation += Math.PI;
    }

    // Turn around best match variables
    let taBestIndex = -1;
    let taMinDiff = Infinity;

    let bestOptions = {
        forward: { index: -1, score: -Infinity, angle: 0 },
        left: { index: -1, score: -Infinity, angle: 0 },
        right: { index: -1, score: -Infinity, angle: 0 },
        backward: { index: -1, score: -Infinity, angle: 0 }
    };

    state.layers.streetview.forEach((sv, index) => {
        if (index === currentStreetViewIndex) return;

        const svLon = sv.geometry.coordinates[0];
        const svLat = sv.geometry.coordinates[1];

        if (Math.abs(svLon - currentLon) < 0.00001 && Math.abs(svLat - currentLat) < 0.00001) return;

        const distance = getDistance(currentLat, currentLon, svLat, svLon);
        const targetId = sv.properties.id;

        // Restrict intersections to very close points (800m) to prevent teleporting far away.
        const isSequence = Math.abs(targetId - currentId) === 1;
        if (!isSequence && distance > 0.8) return;
        if (isSequence && distance > 10.0) return;

        const targetRotation = sv.properties.truck_rotation * Math.PI * 2;

        // Turn around logic uses the telemetry diff since it cancels out offsets
        if (distance < 0.8) {
            const rotationDiff = Math.abs(targetRotation - targetTaRotation);
            const normalizedRotationDiff = Math.min(rotationDiff, 2 * Math.PI - rotationDiff);
            if (normalizedRotationDiff < taMinDiff && normalizedRotationDiff < Math.PI / 2) {
                taMinDiff = normalizedRotationDiff;
                taBestIndex = index;
            }
        }

        // Calculate bearing strictly on the visual Canvas plane
        const pTarget = transform(svLon, svLat);
        let tdy = pTarget.y - pCenter.y;
        let tdx = pTarget.x - pCenter.x;
        let bearing = Math.atan2(tdx, -tdy); // 0 is UP, PI/2 is RIGHT
        if (bearing < 0) bearing += 2 * Math.PI;

        let relativeAngle = bearing - actualTruckRotation;
        if (relativeAngle > Math.PI) relativeAngle -= 2 * Math.PI;
        if (relativeAngle < -Math.PI) relativeAngle += 2 * Math.PI;

        // Rotation diff (for filtering backward-facing captures at intersections)
        let rotDiff = targetRotation - currentRotation;
        if (rotDiff > Math.PI) rotDiff -= 2 * Math.PI;
        if (rotDiff < -Math.PI) rotDiff += 2 * Math.PI;
        const absRotDiff = Math.abs(rotDiff);

        // Strict sequence override handles road bends and sparse gaps perfectly
        if (targetId === currentId + 1) {
            bestOptions.forward.score = Infinity;
            bestOptions.forward.index = index;
            bestOptions.forward.angle = relativeAngle;
            return;
        }
        if (targetId === currentId - 1) {
            bestOptions.backward.score = Infinity;
            bestOptions.backward.index = index;
            bestOptions.backward.angle = relativeAngle;
            return;
        }

        // Base score: heavily penalize distance
        let score = - (distance * 1000);

        // Fallback geometric logic for branching / intersections
        if (Math.abs(relativeAngle) < Math.PI / 3) { // 60 deg cone
            if (absRotDiff < Math.PI / 2) {
                let fScore = score - absRotDiff * 10;
                if (fScore > bestOptions.forward.score && bestOptions.forward.score !== Infinity) {
                    bestOptions.forward.score = fScore;
                    bestOptions.forward.index = index;
                    bestOptions.forward.angle = relativeAngle;
                }
            }
        } else if (relativeAngle >= Math.PI / 3 && relativeAngle <= 2 * Math.PI / 3) {
            // Right (60 to 120 deg)
            if (score > bestOptions.right.score) {
                bestOptions.right.score = score;
                bestOptions.right.index = index;
                bestOptions.right.angle = relativeAngle;
            }
        } else if (relativeAngle <= -Math.PI / 3 && relativeAngle >= -2 * Math.PI / 3) {
            // Left (-60 to -120 deg)
            if (score > bestOptions.left.score) {
                bestOptions.left.score = score;
                bestOptions.left.index = index;
                bestOptions.left.angle = relativeAngle;
            }
        } else if (Math.abs(relativeAngle) > 2 * Math.PI / 3) {
            // Backward
            if (absRotDiff < Math.PI / 2) {
                let bScore = score - absRotDiff * 10;
                if (bScore > bestOptions.backward.score && bestOptions.backward.score !== Infinity) {
                    bestOptions.backward.score = bScore;
                    bestOptions.backward.index = index;
                    bestOptions.backward.angle = relativeAngle;
                }
            }
        }
    });

    // Construct the 3D-perspective ground navigation cluster
    const clusterWrap = document.createElement('div');
    clusterWrap.style.cssText = `
            position: absolute;
            bottom: 12%;
            left: 50%;
            width: 0px;
            height: 0px;
            transform: translateX(-50%) perspective(600px) rotateX(70deg);
            pointer-events: none;
            z-index: 2000;
        `;

    // Turn Around Button in exact center
    const centerTa = document.createElement('div');
    centerTa.style.cssText = `
            position: absolute;
            top: 50%; left: 50%;
            transform: translate(-50%, -50%);
            width: 70px; height: 70px;
            background: rgba(0,0,0,0.5);
            backdrop-filter: blur(10px);
            border: 2px solid rgba(255,255,255,0.7);
            border-radius: 50%;
            pointer-events: auto;
            cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            color: #fff; font-size: 28px; font-weight: bold;
            transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            box-shadow: 0 10px 30px rgba(0,0,0,0.8), inset 0 0 15px rgba(255,255,255,0.2);
        `;
    centerTa.innerHTML = '&#x21bb;';
    centerTa.onclick = () => {
        if (taBestIndex !== -1) {
            openStreetViewModal(taBestIndex);
        } else {
            centerTa.style.background = "#e74c3c";
            setTimeout(() => centerTa.style.background = "rgba(0,0,0,0.5)", 800);
        }
    };
    centerTa.onmouseover = () => { centerTa.style.transform = 'translate(-50%, -50%) scale(1.15)'; centerTa.style.background = 'rgba(255,255,255,0.2)'; };
    centerTa.onmouseout = () => { centerTa.style.transform = 'translate(-50%, -50%) scale(1)'; centerTa.style.background = 'rgba(0,0,0,0.5)'; };
    clusterWrap.appendChild(centerTa);

    // Sleek Map-style ground chevron
    const modernIcon = `<svg width="40" height="40" viewBox="0 0 100 100" style="filter: drop-shadow(0 -5px 15px rgba(255,255,255,0.7)) drop-shadow(0 5px 5px rgba(0,0,0,0.9));"><path d="M10,80 L50,15 L90,80 L50,60 Z" fill="rgba(255,255,255,1)" stroke="rgba(0,0,0,0.3)" stroke-width="2"/></svg>`;

    ['forward', 'left', 'right', 'backward'].forEach(dir => {
        if (bestOptions[dir].index !== -1 && streetviewArrowsOverlay) {
            let rotRad = bestOptions[dir].angle;
            let rotDeg = rotRad * 180 / Math.PI;

            // Path Line connecting center to chevron
            const pathLine = document.createElement('div');
            pathLine.style.cssText = `
                    position: absolute;
                    bottom: 50%; left: 50%;
                    width: 6px; height: 160px;
                    background: linear-gradient(to top, rgba(255,255,255,0) 0%, rgba(255,255,255,0.8) 100%);
                    transform-origin: bottom center;
                    transform: translateX(-50%) rotate(${rotDeg}deg) translateY(-40px);
                    border-radius: 4px;
                    box-shadow: 0 0 15px rgba(0,0,0,0.8);
                    opacity: 0.5;
                    transition: all 0.3s ease;
                    pointer-events: none;
                `;
            clusterWrap.appendChild(pathLine);

            const arrowContainer = document.createElement('div');
            arrowContainer.style.cssText = `
                    position: absolute; 
                    top: 50%; left: 50%;
                    cursor: pointer; 
                    pointer-events: auto; 
                    opacity: 0.85; 
                    transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); 
                    display: inline-flex; 
                    transform: translate(-50%, -50%) rotate(${rotDeg}deg) translateY(-205px);
                `;
            arrowContainer.innerHTML = modernIcon;

            arrowContainer.onmouseover = () => {
                arrowContainer.style.opacity = '1';
                arrowContainer.style.transform = `translate(-50%, -50%) rotate(${rotDeg}deg) translateY(-205px) scale(1.4)`;
                pathLine.style.opacity = '1';
                pathLine.style.background = 'linear-gradient(to top, rgba(255,215,0,0) 0%, rgba(255,215,0,0.9) 100%)';
                pathLine.style.boxShadow = '0 0 20px rgba(255,215,0,0.8)';
            };
            arrowContainer.onmouseout = () => {
                arrowContainer.style.opacity = '0.85';
                arrowContainer.style.transform = `translate(-50%, -50%) rotate(${rotDeg}deg) translateY(-205px) scale(1)`;
                pathLine.style.opacity = '0.5';
                pathLine.style.background = 'linear-gradient(to top, rgba(255,255,255,0) 0%, rgba(255,255,255,0.8) 100%)';
                pathLine.style.boxShadow = '0 0 15px rgba(0,0,0,0.8)';
            };
            arrowContainer.onclick = () => openStreetViewModal(bestOptions[dir].index);

            clusterWrap.appendChild(arrowContainer);
        }
    });

    if (streetviewArrowsOverlay) {
        streetviewArrowsOverlay.appendChild(clusterWrap);
    }

    drawMinimap();
}

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
}) ();
