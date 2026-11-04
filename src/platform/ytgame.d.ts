/**
 * Minimal typings for the YouTube Playables SDK global, loaded from
 * https://www.youtube.com/game_api/v1 by index.html (never bundled).
 * See https://developers.google.com/youtube/gaming/playables/reference/sdk
 */
declare namespace ytgame {
  const IN_PLAYABLES_ENV: boolean;
  const SDK_VERSION: string;

  namespace game {
    function firstFrameReady(): void;
    function gameReady(): void;
    function loadData(): Promise<string>;
    function saveData(data: string): Promise<void>;
  }
  namespace engagement {
    function sendScore(score: { value: number }): Promise<void>;
  }
  namespace system {
    function getLanguage(): Promise<string>;
    function isAudioEnabled(): boolean;
    function onAudioEnabledChange(cb: (enabled: boolean) => void): () => void;
    function onPause(cb: () => void): () => void;
    function onResume(cb: () => void): () => void;
  }
  namespace ads {
    function requestInterstitialAd(): Promise<void>;
  }
  namespace health {
    function logError(): void;
    function logWarning(): void;
  }
}
