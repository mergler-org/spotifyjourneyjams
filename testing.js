const express = require("express");
const { createServer, get } = require("http");
const { Server } = require("socket.io");

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
  similarArtists,
  collectSongRecommendations,
  addToPlaylist,
  shuffleArray,
  makeArtistList,
  pickSongs,
  searchTracks,
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
  const session = req.session;
  const duration = req.session.duration;
  try {
    const { selection, searchType, creativity } = req.body;
    req.session.selection = selection;
    req.session.searchType = searchType;

    // algortithm time
    console.log(selection, searchType, creativity);
    const creativityLookupTable = {
      // whether or not to use top tracks, how many similar artists, and recommended limit
      1: [true, 0, 0],
      2: [true, 3, 0],
      3: [true, 5, 0],
      4: [true, 15, 0],
      5: [true, 15, 25],
      6: [true, 15, 50],
      7: [true, 10, 50],
      8: [false, 4, 100],
      9: [false, 0, 100],
      10: [false, 0, 20],
    };

    // if toptracks is true and not enough songs, find more similar artists, if some recommends then find more recommends, if false find only more recommends
    parameters = creativityLookupTable[creativity];

    async function collectSongList(
      spotifyApi,
      parameters,
      selection,
      searchType,
      duration
    ) {        
      let songList = [];
      if (searchType == "artist"){
        var artistSelection = selection;
      } else if (searchType == "song"){
        var artistSelection = await spotifyApi.getTracks([selection, selection]);
        artistSelection = artistSelection.body.tracks[0].artists[0].id
      }

      if (parameters[1] > 0) {
        var artistList = await similarArtists(spotifyApi, artistSelection);
      } else {
        var artistList = [];
      }
      if (parameters[0] == true) {
        const trackList = await topTracks(spotifyApi, artistSelection);
        songList.push(...trackList);

        if (artistList.length > 0) {
          if (artistList.length <= parameters[1]) {
            for (i in artistList) {
              const trackList = await topTracks(spotifyApi, artistList[i].id);
              songList.push(...trackList);
            }
          } else {
            for (i in artistList.slice(0, parameters[1])) {
              const trackList = await topTracks(spotifyApi, artistList[i].id);
              songList.push(...trackList);
            }
          }
        } else {
          const trackList = await topTracks(spotifyApi, selection);
          songList.push(...trackList);
        }
      }
      if (parameters[2] > 0) {
        const recommendedTracks = await collectSongRecommendations(
          spotifyApi,
          searchType,
          selection,
          parameters[2]
        );
        songList.push(...recommendedTracks);
      }

      let lengthOfSongs = 0;
      for (i in songList) {
        lengthOfSongs += songList[i].duration / 1000;
      }
      let iteration = 0;

      while (lengthOfSongs < duration + 300) {
        iteration += 1;
        console.log("getting more songs");
        if (
          parameters[0] == true &&
          parameters[1] > 0 &&
          parameters[1] < artistList.length
        ) {
          const trackList = await topTracks(
            spotifyApi,
            artistList[parameters[1] + iteration].id
          );
          for (i in trackList) {
            lengthOfSongs += trackList[i].duration / 1000;
          }
          songList.push(...trackList);
        }
        if (parameters[2] > 0) {
          const recommendedTracks = await collectSongRecommendations(
            spotifyApi,
            searchType,
            selection,
            parameters[2]
          );
          for (i in recommendedTracks) {
            lengthOfSongs += recommendedTracks[i].duration / 1000;
          }
          songList.push(...recommendedTracks);
        }
        if (iteration > 100) {
          console.log("oh no a long endless loop!!");
          break;
        }
      }

      console.log(lengthOfSongs, duration);
      return songList;
    }

    const songList = await collectSongList(
      spotifyApi,
      parameters,
      selection,
      searchType,
      duration
    );
    const pickedSongs = await pickSongs(duration, songList);

    let howLongisit = 0;
    for (i in pickedSongs) {
      howLongisit += pickedSongs[i].duration / 1000;
      console.log(
        pickedSongs[i].artist.name + "  ---  " + pickedSongs[i].track
      );
    }
    console.log(
      "playlist is:",
      howLongisit,
      "seconds compared to the drive which is",
      duration
    );
    //output {creativity: ___, artist -- song..., target duration, actual duration}

    res.status(200).end();
  } catch (error) {
    console.error("Error during playlist creation:", error);
    res
      .status(500)
      .json({ error: "Internal Server Error on playlist creation" });
  }
});

app.get("/loading", spotifyApiMiddleware, async (req, res) => {
  try {
    res.render("loading");
  } catch (error) {
    console.error("Error during loading:", error);
    res.status(500).json({ error: "Internal Server Error on loading screen" });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
