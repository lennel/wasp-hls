use crate::{
    wasm_bindgen,
    js_functions::{
        PlayerId,
        jsAttachMediaSource,
        LogLevel, jsFetchU8,
    },
    source_buffer::SourceBuffersStore,
    utils::url::Url,
    Logger,
    requester::{Requester, PlaylistFileType},
};

use super::super::SegmentQueues;
use super::super::{
    WaspHlsPlayer,
    WaspHlsPlayerReadyState,
};

/// Methods exposed to the JavaScript-side
#[wasm_bindgen]
impl WaspHlsPlayer {
    #[wasm_bindgen(constructor)]
    pub fn new(player_id: PlayerId) -> Self {
        WaspHlsPlayer {
            id: player_id,
            ready_state: WaspHlsPlayerReadyState::Stopped,
            content: None,
            media_source_state: None,
            requester: Requester::new(player_id),
            source_buffer_store: SourceBuffersStore::new(player_id),
            segment_queues: SegmentQueues::new(),
            last_position: 0.,
            buffer_goal: 30.,
        }
    }

    pub fn load_content(&mut self, content_url: String) {
        Logger::info("load_content called");
        self.stop();
        self.ready_state = WaspHlsPlayerReadyState::Loading;
        let content_url = Url::new(content_url);
        self.requester.fetch_playlist(content_url, PlaylistFileType::Unknown);
        Logger::info("Attaching MediaSource");
        jsAttachMediaSource(self.id);
    }

    pub fn stop(&mut self) {
        self.internal_stop();
    }

    pub fn log(level: LogLevel, msg: &str) {
        match level {
            LogLevel::Error => Logger::error(msg),
            LogLevel::Warn => Logger::warn(msg),
            LogLevel::Info => Logger::info(msg),
            LogLevel::Debug => Logger::debug(msg),
        }
    }

    pub fn test_seg_back_and_forth(&self) {
        jsFetchU8(self.id, "http://127.0.0.1:8080/lowlat_vs_non_lowlat.mp4");
    }
}

