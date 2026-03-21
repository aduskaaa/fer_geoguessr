window.FER_DATA_LOADING = (async () => {
    // If window.FER_DATA is already defined (e.g. from fer-geojson.js), we are done.
    if (window.FER_DATA) return;

    const geojsonPath = 'assets/Interactive Map/Map DATA/fer.geojson';

    try {
        const res = await fetch(geojsonPath);
        if (!res.ok) {
            throw new Error(`Failed to load ${geojsonPath}: ${res.statusText}`);
        }
        window.FER_DATA = await res.json();
    } catch (error) {
        console.error('Error loading GeoJSON data:', error);
    }
})();
