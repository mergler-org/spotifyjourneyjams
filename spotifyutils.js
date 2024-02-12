async function searchArtist(spotifyApi, artistInput, offset=0) {
  try {
    const results = await spotifyApi.searchArtists(artistInput, {limit:10, offset:offset});
    const artists = results.body.artists.items;
    return artists;
  } catch (error) {
    throw new Error(`Error saerching artists: ${error.message}`);
  }
}

async function searchTracks(spotifyApi, songInput, offset=0) {
  try {
    const results = await spotifyApi.searchTracks(songInput, {limit:10, offset: offset})
    const songs = results.body.tracks.items;
    return songs;
  } catch (error) {
    throw new Error(`Error searching tracks: ${error.message}`);
  }
}
async function topTracks(spotifyApi, artistCode) {
  try {
    const country = "US"; // Replace with the desired country code

    // Get the top tracks for the specified artist in the specified country
    const response = await spotifyApi.getArtistTopTracks(artistCode, country);
    const topTracksData = response.body.tracks;

    // Return a list of dictionaries with uri and name
    const trackList = topTracksData.map((track) => ({
      track: track.name,
      duration: track.duration_ms,
      id: track.id,
      preview: track.preview_url,
      url: track.external_urls.spotify,
      artist: track.artists[0],
      album: track.album,
    }));

    return trackList;
  } catch (error) {
    throw new Error(
      `Error getting top tracks for ${artistCode}: ${error.message}`
    );
  }
}

async function collectSongRecommendations(spotifyApi, kind, id, limit) {
  let seed;
  if (kind == 'artist') {
    seed = "seed_artists";
  } else if (kind == 'song') {
    seed = "seed_tracks";
  } else {
    throw new Error("Invalid kind");
  }

  try {
    const response = await spotifyApi.getRecommendations({ [seed]: id, limit: limit });
    let recommendationList = response.body.tracks.map((track) => ({
      track: track.name,
      duration: track.duration_ms,
      id: track.id,
      preview: track.preview_url,
      url: track.external_urls.spotify,
      artist: track.artists[0],
      album: track.album,
    }))
    return recommendationList
  } catch (error) {
    console.error("Error collecting songs:", error);
  }
}

async function similarArtists(spotifyApi, artistCode) {
  try {
    const response = await spotifyApi.getArtistRelatedArtists(artistCode);
    const relatedArtists = response.body.artists;

    const artistList = relatedArtists.map((artist) => ({
      id: artist.id,
      name: artist.name,
      genres: artist.genres,
      images: artist.images,
      
    }));

    return artistList;
  } catch (error) {
    throw new Error(
      `Error getting similar artists for ${artistCode}: ${error.message}`
    );
  }
}

async function addToPlaylist(spotifyApi, songIds, playlistUri) {
  const chunkSize = 100;
  const totalChunks = Math.ceil(songIds.length / chunkSize);

  for (let i = 0; i < totalChunks; i++) {
    const startIndex = i * chunkSize;
    const endIndex = (i + 1) * chunkSize;
    const chunkSongIds = songIds.slice(startIndex, endIndex);

    try {
      // Add songs to the playlist
      await spotifyApi.addTracksToPlaylist(
        playlistUri,
        chunkSongIds
      );
    } catch (error) {
      console.error(
        `Error adding chunk ${i + 1} to the playlist:`,
        error.message
      );
    }
  }
}

async function makeArtistList(spotifyApi, startingArtist, howMany) {
  try {
    // make list of artists
    let baseArtist = startingArtist;
    var artistDictionary = [startingArtist];
    const indicesForSearch = [0];
    while (artistDictionary.length < howMany) {
      const similarArtistList = await similarArtists(spotifyApi, baseArtist);
      artistDictionary.push(...similarArtistList);

      let j;
      do {
        j = Math.floor(Math.random() * (artistDictionary.length - 1) + 1);
      } while (indicesForSearch.includes(j));
      indicesForSearch.push(j);
    }
    return artistDictionary;
  } catch (error) {
    console.error("Error making list of artists:", error);
    res.status(500).json({ error: "Error making list of artists" });
  }

}

async function pickSongs(duration, songsToSelectFrom, overshootSeconds=120) {
  const selectedSongs = [];
  var currentDuration = 0;

  while (currentDuration < duration) {
    var randomSong = songsToSelectFrom[Math.floor(Math.random() * songsToSelectFrom.length)];
    songDuration = randomSong.duration_ms / 1000;

    if (currentDuration + songDuration > duration + overshootSeconds) {
      if (selectedSongs.length > 0) {
        replacingIndex = Math.floor(Math.random() * selectedSongs.length);
        selectedSongs[replacingIndex] =
          songsToSelectFrom[Math.floor(Math.random() * songsToSelectFrom.length)];
        currentDuration = selectedSongs.reduce(
          (sum, song) => sum + song.duration_ms / 1000,
          0
        );
      }
    } else {
      selectedSongs.push(randomSong);
      currentDuration += songDuration;
      const indexOfRandomSong = songsToSelectFrom.indexOf(randomSong);
      if (indexOfRandomSong !== -1) {
        songsToSelectFrom.splice(indexOfRandomSong, 1);
      }
    }
  }
  return selectedSongs;
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]]; // Swap elements
  }
}

module.exports = {
  searchArtist,
  topTracks,
  similarArtists,
  addToPlaylist,
  makeArtistList,
  pickSongs,
  shuffleArray,
  searchTracks,
  collectSongRecommendations
}
