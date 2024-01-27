const express = require("express");
const SpotifyWebApi = require("spotify-web-api-node");
const path = require("path");
require("dotenv").config();
const bodyParser = require("body-parser");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const { geocode, drivingTraffic, formatDistance, formatDuration } = require("./geocodeutils");
const {
  searchArtist,
  topTracks,
  similarArtists,
  addTracks,
  shuffleArray,
  makeArtistList,
  pickSongs,
  searchTracks
} = require("./spotifyutils");
const fetch = require("node-fetch");

//Server side constants used
const port = 3000;
const clientId = process.env.CLIENTID;
const clientSecret = process.env.CLIENTSECRET;
const redirectUri = process.env.REDIRECTURI; // Change this if needed
const MAPBOX_ACCESS_TOKEN = process.env.MAPBOX_ACCESS_TOKEN;
exports.MAPBOX_ACCESS_TOKEN = MAPBOX_ACCESS_TOKEN;

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
exports.app = app;
// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));

// Set EJS as the view engine
app.set("view engine", "ejs");

// Set the views directory
app.set("views", path.join(__dirname, "views"));

app.use(cookieParser());

app.use(
  session({
    secret: process.env.SESSIONKEY, // Replace with a secret key for session encryption
    resave: false,
    saveUninitialized: true,
  })
);

// spotifyApi authentication middleware
function spotifyApiMiddleware(req, res, next) {
  if (!req.session.spotifyApi) {
    return res.redirect("/login");
  } else {
    const spotifyApi = new SpotifyWebApi({
      clientId: clientId,
      clientSecret: clientSecret,
      redirectUri: redirectUri,
    });
    spotifyApi.setAccessToken(req.session.spotifyApi.accessToken);
    spotifyApi.setRefreshToken(req.session.spotifyApi.refreshToken);

    req.spotifyApi = spotifyApi;
  }
  next();
}
exports.spotifyApiMiddleware = spotifyApiMiddleware;

// Add a route to reset session data when visiting the home page
app.get("/", (req, res) => {
  res.render("index");
});

// login route
app.get("/login", (req, res) => {
  const spotifyApi = new SpotifyWebApi({
    clientId: clientId,
    clientSecret: clientSecret,
    redirectUri: redirectUri,
  });
  try {
    const scopes = ["playlist-modify-private", "playlist-modify-public"];
    const authorizeURL = spotifyApi.createAuthorizeURL(scopes);
    res.redirect(authorizeURL);
  } catch (error) {
    console.error("Error generating Spotify authorization URL:", error);
    res.status(500).send("Internal Server Error");
  }
});

// Handle Spotify API callback
app.get("/callback", async (req, res) => {
  const { code } = req.query;
  const spotifyApi = new SpotifyWebApi({
    clientId: clientId,
    clientSecret: clientSecret,
    redirectUri: redirectUri,
  });
  try {
    const data = await spotifyApi.authorizationCodeGrant(code);
    const { access_token, refresh_token } = data.body;

    // Set the access token and refresh token on the Spotify API object
    spotifyApi.setAccessToken(access_token);
    spotifyApi.setRefreshToken(refresh_token);

    // Update the serialized SpotifyWebApi object in the session
    req.session.spotifyApi = {
      clientId: spotifyApi.getClientId(),
      clientSecret: spotifyApi.getClientSecret(),
      redirectUri: spotifyApi.getRedirectURI(),
      accessToken: spotifyApi.getAccessToken(),
      refreshToken: spotifyApi.getRefreshToken(),
    };

    res.redirect("/location");
  } catch (error) {
    console.error("Error authenticating with Spotify:", error);
    res.redirect("/login"); // Add this line to terminate the function after sending the error response
  }
});

app.get("/location", spotifyApiMiddleware, (req, res) => {
  res.render("location");
});

// Modify your route to return JSON data
app.post("/geocoding", async (req, res) => {
  const { startingPoint, destination } = req.body;
  try {
    req.session.startingPointData = await geocode(
      startingPoint,
      MAPBOX_ACCESS_TOKEN
    );
    req.session.destinationData = await geocode(
      destination,
      MAPBOX_ACCESS_TOKEN
    );
  } catch (error) {
    console.error("Error geocoding \n", error.message);
    res.status(500).json({ error: "Error submitting request" });
    return;
  }

  try {
    // Get driving traffic information
    var { duration, distance, errorMessage } = await drivingTraffic(
      req.session.startingPointData.coordinates,
      req.session.destinationData.coordinates,
      MAPBOX_ACCESS_TOKEN
    );

    req.session.duration = duration;
    req.session.distance = distance;

    duration = formatDuration(duration);
    distance = formatDistance(distance);

    if (errorMessage) {
      console.error(errorMessage);
      res
        .status(500)
        .json({ error: "Error processing the request for driving directions" });
      return;
    }

    // Respond with JSON data
    res.json({
      startingPointData: req.session.startingPointData.addressFull,
      destinationData: req.session.destinationData.addressFull,
      duration: duration,
      distance: distance,
    });
  } catch (error) {
    console.error("Error during distance calculation:", error);
    res.status(500).json({ error: "Error during distance calculation" });
  }
});

app.get("/music", spotifyApiMiddleware, (req, res) => {
  if (!req.session.duration || !req.session.distance) {
    return res.redirect("location");
  }

  duration = formatDuration(req.session.duration);
  distance = formatDistance(req.session.distance);

  res.render("music", {
    distance: distance,
    duration: duration,
  });
});

app.post("/search", spotifyApiMiddleware, async (req, res) => {
  const spotifyApi = req.spotifyApi;
  const { searchTerm, searchType, creativity, offset } = req.body;
  req.session.creativity = creativity
  if (searchType == "artist") {
    const artistList = await searchArtist(spotifyApi, searchTerm, offset);

    res.json({ search: artistList });
  }
  if (searchType == "song") {
    const songList = await searchTracks(spotifyApi,searchTerm, offset);

    res.json({search: songList})
  }
});

app.post("/topSongs", spotifyApiMiddleware, async (req, res) => {
  const spotifyApi = req.spotifyApi;
  const { artistId } = req.body;
    const tracks = await topTracks(spotifyApi, artistId);

    res.json({ tracks: tracks });
});

app.post("/submit", spotifyApiMiddleware, async (req, res) => {
  const { startingPoint, destination, artist } = req.body;
  const spotifyApi = req.spotifyApi;

  try {
    // Geocode and store data in the session
    req.session.startingPointData = await geocode(
      startingPoint,
      MAPBOX_ACCESS_TOKEN
    );
    req.session.destinationData = await geocode(
      destination,
      MAPBOX_ACCESS_TOKEN
    );

    // Fetch additional data (if needed)
    const startingArtist = await searchArtist(spotifyApi, artist);
    const songs = await topTracks(spotifyApi, startingArtist.id);

    // Store additional data in the session
    req.session.startingArtist = startingArtist;
    req.session.songs = songs;
    // Render the EJS template with data
    res.render("verify", {
      startingPoint: req.session.startingPointData,
      destination: req.session.destinationData,
      artist: req.session.startingArtist,
      testSongs: req.session.songs,
      artistImage: req.session.startingArtist.images[0].url,
    });
  } catch (error) {
    // Handle errors, log, or send an error response
    console.error(error.message);
    res.status(500).send("Error submitting request");
  }
});

app.get("/loading", spotifyApiMiddleware, async (req, res) => {
  try {
    // Render the "loading" view immediately
    res.render("loading", { includeScript: true });
  } catch (error) {
    console.error("Error during loading:", error);
    res.status(500).json({ error: "Internal Server Error on loading screen" });
  }
});

app.get("/loadingdebug", async (req, res) => {
  try {
    // Render the "loading" view immediately and make the script for /work not run
    res.render("loading", { includeScript: false });
  } catch (error) {
    console.error("Error during loading:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/work", spotifyApiMiddleware, async (req, res) => {
  // Deserialize the SpotifyWebApi object from the session
  const spotifyApi = req.spotifyApi;

  try {
    // Ensure that startingPointData and destinationData are available in the session
    if (!req.session.startingPointData || !req.session.destinationData) {
      console.error("Starting point or destination data not available");
      res.redirect("/form");
      return;
    }

    // Get driving traffic information
    var { duration, distance, errorMessage } = await drivingTraffic(
      req.session.startingPointData.coordinates,
      req.session.destinationData.coordinates,
      MAPBOX_ACCESS_TOKEN
    );

    req.session.duration = duration;
    req.session.distance = distance;

    if (errorMessage) {
      console.error(errorMessage);
      res
        .status(500)
        .json({ error: "Error processing the request for driving directions" });
      return;
    }
  } catch (error) {
    console.error("Error during distance calculation:", error);
    res.status(500).json({ error: "Error during distance calculation" });
  }

  // list of artists is an external function now
  const artistDictionary = await makeArtistList(
    spotifyApi,
    req.session.startingArtist,
    duration
  );
  req.session.artist = artistDictionary;
  try {
    var songs = req.session.songs;
    //make list of songs
    for (let i = 1; i < artistDictionary.length - 1; i++) {
      artist = artistDictionary[i];
      const artistTopTracks = await topTracks(spotifyApi, artist.id);

      songs.push(...artistTopTracks);
    }
  } catch (error) {
    console.error("Error finding artists top tracks:", error);
    res.status(500).json({ error: "Error finding artists top tracks" });
  }

  //shuffle songs and prepare for playlist
  const songsToSelectFrom = [...songs]; // Using the spread operator to create a shallow copy
  shuffleArray(songsToSelectFrom); // Assuming shuffleArray is a function that shuffles the array

  const overshootSeconds = 120;
  // external function to make song list now
  selectedSongs = await pickSongs(
    duration,
    overshootSeconds,
    songsToSelectFrom
  );

  shuffleArray(selectedSongs);
  req.session.songs = selectedSongs;
  var songIds = selectedSongs.map((song) => song.id);

  try {
    // Create playlist
    const playlistName = "Road Trip!";
    const playlistDescription = "Made with love on Spotify Journey";

    // Get the current user's ID
    const userId = await spotifyApi.getMe();

    // Create the playlist
    var roadTripPlaylist = await spotifyApi.createPlaylist(playlistName, {
      description: playlistDescription,
    });

    // Get the URI of the created playlist
    var playlistUri = roadTripPlaylist.body.id;

    req.session.playlist = roadTripPlaylist;
    addTracks(spotifyApi, songIds, playlistUri);
  } catch (error) {
    console.error("Error creating playlist:", error.message);
    // Handle the error as needed
  }

  res.redirect("/playlist");
});

// Route for displaying results
app.get("/playlist", spotifyApiMiddleware, (req, res) => {
  const spotifyApi = req.spotifyApi;

  try {
    // Render the EJS template with data
    res.render("playlist", {
      artist: req.session.startingArtist.name,
      songs: req.session.songs,
      playlist: req.session.playlist,
      duration: req.session.duration,
      distance: req.session.distance, // Make sure to pass the playlist data
    });
  } catch (error) {
    // Handle errors, log, or send an error response
    console.error(error.message);
    res.status(500).send("Error displaying results");
  }
});

app.get("/playlistdebug", (req, res) => {
  try {
    const filePath = path.join(__dirname, "test.json");
    const debugsession = require(filePath);

    res.render("playlist", {
      artist: debugsession.startingArtist.name,
      songs: debugsession.songs,
      playlist: debugsession.playlist,
      duration: debugsession.duration,
      distance: debugsession.distance,
    });
  } catch (error) {
    console.error("Error loading or parsing JSON file:", error);
    // Handle the error, but don't send a response here
  }
});

app.get("/debug", spotifyApiMiddleware, (req, res) => {
  try {
    const spotifyApi = req.session.spotifyApi;
    // Create a private playlist
    spotifyApi
      .createPlaylist("My playlist", {
        description: "My description",
        public: true,
      })
      .then(
        function (data) {
          console.log("Created playlist!");
        },
        function (err) {
          console.log("Something went wrong!", err);
        }
      );
  } catch (error) {
    console.error("Error loading or parsing JSON file:", error);
    return;
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
