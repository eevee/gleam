export const CAN_PLAY_AUDIO = (function() {
  const dummy_audio = document.createElement('audio');
  return dummy_audio.canPlayType && dummy_audio.canPlayType('audio/ogg; codecs="vorbis"');
})();