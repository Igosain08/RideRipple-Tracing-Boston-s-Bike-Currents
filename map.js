// Import required libraries
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Replace with your Mapbox access token - you should create your own
mapboxgl.accessToken = 'pk.eyJ1IjoiaWdvc2FpbiIsImEiOiJjbWFyZHNvMjAwNWNoMm5weWRzdTNsMDMyIn0.KcAZpv1uPsNuOE-StpxzZg';

// Utility functions for time handling
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// State variables
let timeSlider, selectedTime, anyTimeLabel;
let timeFilter = -1;
let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);
let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);
let allStations = [];
let radiusScale;

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/satellite-streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

// Helper function to get coordinates for stations
function getCoords(station) {
  const lat = station.Lat || station.lat;
  const lon = station.Long || station.lon;
  if (!lat || !lon) return { cx: 0, cy: 0 };
  const point = new mapboxgl.LngLat(+lon, +lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

// Filter trips by time of day
function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) return tripsByMinute.flat();

  let minMinute = (minute - 60 + 1440) % 1440;
  let maxMinute = (minute + 60) % 1440;

  if (minMinute > maxMinute) {
    return tripsByMinute.slice(minMinute).concat(tripsByMinute.slice(0, maxMinute + 1)).flat();
  } else {
    return tripsByMinute.slice(minMinute, maxMinute + 1).flat();
  }
}

// Compute traffic for stations based on time filter
function computeStationTraffic(stations, timeFilter = -1) {
  const departures = d3.rollup(
    filterByMinute(departuresByMinute, timeFilter),
    v => v.length,
    d => d.start_station_id
  );

  const arrivals = d3.rollup(
    filterByMinute(arrivalsByMinute, timeFilter),
    v => v.length,
    d => d.end_station_id
  );

  return stations.map(station => {
    const id = station.Number || station.short_name;
    station.departures = departures.get(id) ?? 0;
    station.arrivals = arrivals.get(id) ?? 0;
    station.totalTraffic = station.departures + station.arrivals;
    return station;
  });
}

// Wait for map to load before adding data
map.on('style.load', async () => {
  // Add Boston bike lanes
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  map.addLayer({
    id: 'bike-lanes-boston',
    type: 'line',
    source: 'boston_route',
    paint: {
      'line-color': '#32D400',
      'line-width': 3,
      'line-opacity': 0.5,
    },
  });

  // Add Cambridge bike lanes
  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
  });

  map.addLayer({
    id: 'bike-lanes-cambridge',
    type: 'line',
    source: 'cambridge_route',
    paint: {
      'line-color': '#32D400',
      'line-width': 3,
      'line-opacity': 0.5,
    },
  });

  try {
    // Load station data
    const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
    const jsonData = await d3.json(jsonurl);
    allStations = jsonData.data.stations.filter(
      (s) => (s.Lat || s.lat) && (s.Long || s.lon)
    );
    
    // Select SVG element
    const svg = d3.select('#map').select('svg');

    // Load trip data
    let trips = await d3.csv(
      'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
      (trip) => {
        trip.started_at = new Date(trip.started_at);
        trip.ended_at = new Date(trip.ended_at);
    
        const startedMinutes = minutesSinceMidnight(trip.started_at);
        const endedMinutes = minutesSinceMidnight(trip.ended_at);
    
        departuresByMinute[startedMinutes].push(trip);
        arrivalsByMinute[endedMinutes].push(trip);
    
        return trip;
      }
    );
    
    console.log('Loaded trips:', trips);

    // Calculate traffic statistics
    const stations = computeStationTraffic(allStations);

    // Create radius scale based on traffic
    radiusScale = d3
      .scaleSqrt()
      .domain([0, d3.max(stations, (d) => d.totalTraffic)])
      .range([0, 25]);

    // Create circles for each station
    const circles = svg
      .selectAll('circle')
      .data(stations, d => d.Number || d.short_name)
      .enter()
      .append('circle')
      .attr('r', d => radiusScale(d.totalTraffic))
      .attr('fill', 'steelblue')
      .attr('stroke', 'white')
      .attr('stroke-width', 1)
      .attr('opacity', 0.8)
      .style('--departure-ratio', (d) => 
        stationFlow(d.departures / (d.totalTraffic || 1))
      )
      .each(function (d) {
        d3.select(this)
          .append('title')
          .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
      });

    // Function to update circle positions
    function updatePositions() {
      circles
        .attr('cx', (d) => getCoords(d).cx)
        .attr('cy', (d) => getCoords(d).cy);
    }

    // Initial position update
    updatePositions();
    
    // Update positions when map changes
    map.on('move', updatePositions);
    map.on('zoom', updatePositions);
    map.on('resize', updatePositions);
    map.on('moveend', updatePositions);

    // Function to update visualization based on time filter
    function updateScatterPlot(timeFilter) {
      const filteredStations = computeStationTraffic(allStations, timeFilter);
    
      // Adjust circle size range based on filter
      timeFilter === -1
        ? radiusScale.range([0, 25])
        : radiusScale.range([3, 50]);
    
      // Update circles with new data
      circles
        .data(filteredStations, d => d.Number || d.short_name)
        .join('circle')
        .attr('r', d => radiusScale(d.totalTraffic))
        .attr('cx', d => getCoords(d).cx)
        .attr('cy', d => getCoords(d).cy)
        .style('--departure-ratio', (d) => 
          stationFlow(d.departures / (d.totalTraffic || 1))
        );
    }

    // Set up time filter controls
    timeSlider = document.getElementById('time-slider');
    selectedTime = document.getElementById('selected-time');
    anyTimeLabel = document.getElementById('any-time');

    // Function to update time display and filter data
    function updateTimeDisplay() {
      timeFilter = Number(timeSlider.value);

      if (timeFilter === -1) {
        selectedTime.textContent = '';
        anyTimeLabel.style.display = 'block';
      } else {
        selectedTime.textContent = formatTime(timeFilter);
        anyTimeLabel.style.display = 'none';
      }

      updateScatterPlot(timeFilter);
    }

    // Add event listener to time slider
    timeSlider.addEventListener('input', updateTimeDisplay);
    
    // Initialize display
    updateTimeDisplay();

    console.log('🚲 Bike lanes and traffic visualized');
  } catch (error) {
    console.error('Error loading data:', error);
  }
});