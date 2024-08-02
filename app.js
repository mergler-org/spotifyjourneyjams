const express = require("express");
const axios = require("axios");
const SpotifyWebApi = require("spotify-web-api-node");
const path = require("path");
require("dotenv").config();
const bodyParser = require("body-parser");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const {
  geocode,
  drivingTraffic,
  formatDistance,
  formatDuration,
} = require("./geocodeutils");
const {
  searchArtist,
  topTracks,
  addToPlaylist,
  pickSongs,
  searchTracks,
  collectSongList,
} = require("./spotifyutils");

//Server side constants used
const port = process.env.PORT;
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

app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-cache, no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});
const sessionMiddleware = session({
  secret: process.env.SESSIONKEY, // Replace with a secret key for session encryption
  resave: false,
  saveUninitialized: true,
});
app.use(sessionMiddleware);

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
      MAPBOX_ACCESS_TOKEN,
    );
    req.session.destinationData = await geocode(
      destination,
      MAPBOX_ACCESS_TOKEN,
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
      MAPBOX_ACCESS_TOKEN,
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
  req.session.creativity = creativity;
  if (searchType == "artist") {
    const artistList = await searchArtist(spotifyApi, searchTerm, offset);

    res.json({ search: artistList });
  }
  if (searchType == "song") {
    const songList = await searchTracks(spotifyApi, searchTerm, offset);

    res.json({ search: songList });
  }
});

app.post("/topSongs", spotifyApiMiddleware, async (req, res) => {
  const spotifyApi = req.spotifyApi;
  const { artistId } = req.body;
  const tracks = await topTracks(spotifyApi, artistId);

  res.json({ tracks: tracks });
});

app.post("/saveInfo", spotifyApiMiddleware, async (req, res) => {
  const spotifyApi = req.spotifyApi;
  try {
    const { selection, searchType, creativity } = req.body;
    req.session.selection = selection;
    req.session.searchType = searchType;
    const creativityLookupTable = {
      // whether or not to use top tracks, how many similar artists, and recommended limit
      1: [true, 0, 0],
      2: [true, 2, 0],
      3: [true, 4, 0],
      4: [true, 6, 0],
      5: [true, 10, 0],
      6: [true, 10, 25],
      7: [true, 10, 50],
      8: [false, 4, 100],
      9: [false, 0, 100],
      10: [false, 0, 10],
    };
    req.session.creativityParameters = creativityLookupTable[creativity];
    res.status(200).end();
  } catch (error) {
    console.error("Error during playlist creation:", error);
    res
      .status(500)
      .json({ error: "Internal Server Error on playlist creation" });
  }
});

app.get("/playlist", spotifyApiMiddleware, async (req, res) => {
  try {
    res.render("result");
  } catch (error) {
    console.error("Error during loading:", error);
    res.status(500).json({ error: "Internal Server Error on loading screen" });
  }
});

const PlaylistState = {
  INIT: "INIT",
  COLLECTING_SONGS: "COLLECTING_SONGS",
  PICKING_SONGS: "PICKING_SONGS",
  CREATING_PLAYLIST: "CREATING_PLAYLIST",
  ADDING_SONGS: "ADDING_SONGS",
  COMPLETE: "COMPLETE",
};

async function handlePlaylistCreation(req, res) {
  const spotifyApi = req.spotifyApi;
  const duration = req.session.duration;

  res.writeHead(200, {
    Connection: "keep-alive",
    "Cache-Control": "no-cache",
    "Content-Type": "text/event-stream",
  });

  const state = req.session.playlistState || PlaylistState.INIT;

  try {
    switch (state) {
      case PlaylistState.INIT:
        req.session.playlist = {};
        req.session.playlistState = PlaylistState.COLLECTING_SONGS;
        // Fall through to collect songs

      case PlaylistState.COLLECTING_SONGS:
        console.log("Getting song list");
        const initialSongList = await collectSongList(
          spotifyApi,
          req.session.creativityParameters,
          req.session.selection,
          req.session.searchType,
          duration,
        );
        res.write(`data: ` + JSON.stringify({ foundSongs: true }) + `\n\n`);
        req.session.playlist.songList = await pickSongs(
          duration,
          initialSongList,
        );
        req.session.playlistState = PlaylistState.PICKING_SONGS;
        // Fall through to pick songs

      case PlaylistState.PICKING_SONGS:
        const chunk = JSON.stringify({ choseSongs: true });
        res.write(`data: ${chunk}\n\n`);
        req.session.playlistState = PlaylistState.CREATING_PLAYLIST;
        // Fall through to create playlist

      case PlaylistState.CREATING_PLAYLIST:
        const trackIds = req.session.playlist.songList.map(
          (track) => "spotify:track:" + track.id,
        );
        console.log(trackIds);

        const playlistName = "Road Trip!";
        const playlistDescription = "Made with love on Spotify Journey Jams";

        const userId = await spotifyApi.getMe();
        const roadTripPlaylist = await spotifyApi.createPlaylist(playlistName, {
          description: playlistDescription,
        });

        const playlistUri = roadTripPlaylist.body.id;
        req.session.playlist.playlistData = roadTripPlaylist;
        req.session.playlistState = PlaylistState.ADDING_SONGS;
        // Fall through to add songs

      case PlaylistState.ADDING_SONGS:
        const trackUris = req.session.playlist.songList.map(
          (track) => "spotify:track:" + track.id,
        );
        await addToPlaylist(
          spotifyApi,
          trackUris,
          req.session.playlist.playlistData.body.id,
        );
        req.session.playlistState = PlaylistState.COMPLETE;
        // Fall through to complete

      case PlaylistState.COMPLETE:
        const playlistLinkURL =
          req.session.playlist.playlistData.body.external_urls.spotify;
        const oembedUrl = `https://open.spotify.com/oembed?url=${playlistLinkURL}`;
        const response = await axios.get(oembedUrl);
        const embedHtml = response.data.html;

        const playlistChunk = JSON.stringify({ madePlaylist: embedHtml });
        res.write(`data: ${playlistChunk}\n\n`);

        delete req.session.playlist;
        delete req.session.playlistState;
        res.end();
        break;

      default:
        throw new Error("Unknown playlist state");
    }
  } catch (error) {
    console.error("Error handling playlist creation:", error.message);
    if (!res.headersSent) {
      res.status(500).send("Internal Server Error");
    }
  } finally {
    res.on("close", () => {
      if (!res.headersSent) {
        delete req.session.playlist;
        delete req.session.playlistState;
        res.end();
      }
    });
  }
}

app.get("/stream", spotifyApiMiddleware, handlePlaylistCreation);

// Start the server
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
