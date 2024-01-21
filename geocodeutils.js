const fetch = require("node-fetch");

function geocode(address, access_token) {
  const endpoint = "https://api.mapbox.com/geocoding/v5/mapbox.places/";

  const url = `${endpoint}${address}.json?access_token=${access_token}`;

  return fetch(url)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      return response.json();
    })
    .then((data) => {
      if (data.features && data.features.length > 0) {
        const feature = data.features[0];
        const coordinates = feature.center;
        const addressFull = data.features[0].place_name;

        return { addressFull, coordinates };
      } else {
        throw new Error(`Geocoding failed for: ${address}`);
      }
    })
    .catch((error) => {
      throw new Error(`Error in geocoding: ${error.message}`);
    });
}

async function drivingTraffic(coordinate1, coordinate2, accessToken) {
  const endpoint =
    "https://api.mapbox.com/directions/v5/mapbox/driving-traffic/";

  const params = {
    access_token: accessToken,
    annotations: "distance,duration",
    origin: `${coordinate1[0]}, ${coordinate1[1]}`,
    destination: `${coordinate2[0]}, ${coordinate2[1]}`,
  };

  try {
    const response = await fetch(
      `${endpoint}${params.origin};${params.destination}?access_token=${params.access_token}`
    );
    const data = await response.json();

    if (response.status === 200) {
      const route = data.routes[0]; // Assuming you want data from the first route
      const duration = route.duration;
      const distance = route.distance;

      return { duration, distance };
    } else {
      return {
        errorMessage: `Directions Failed, Please Re-input. API request failed with status code: ${response.status}`,
      };
    }
  } catch (error) {
    return {
      errorMessage: `An error occurred: ${error.message}`,
    };
  }
}

module.exports = {
  geocode,
  drivingTraffic,
};
