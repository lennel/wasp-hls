use crate::{bindings::MediaType, utils::url::Url, Logger};
use std::{error, fmt, io::BufRead};

use super::utils::{
    parse_byte_range, parse_decimal_floating_point, parse_decimal_integer, parse_enumerated_string,
    parse_iso_8601_date, parse_quoted_string,
};

pub use super::utils::ByteRange;

/// Structure representing the concept of the `Media Playlist` in HLS.
#[derive(Clone, Debug)]
pub struct MediaPlaylist {
    pub version: Option<u32>,
    pub independent_segments: bool,
    pub start: StartAttribute,
    pub target_duration: u32,
    pub media_sequence: u32,
    pub discontinuity_sequence: u32,
    pub end_list: bool,
    pub playlist_type: PlaylistType,
    pub i_frames_only: bool,
    pub map: Option<MapInfo>,
    pub segment_list: Vec<SegmentInfo>,
    pub url: Url,
    // TODO
    // pub server_control: ServerControl,
    // pub part_inf: Option<f64>,
}

#[derive(Clone, Debug)]
pub struct MapInfo {
    pub uri: Url,
    pub byte_range: Option<ByteRange>,
}

#[derive(Clone, Debug)]
pub struct SegmentInfo {
    pub start: f64,
    pub duration: f64,
    pub byte_range: Option<ByteRange>,
    pub url: Url,
}

#[derive(Clone, Copy, Debug)]
pub enum PlaylistType {
    Event,
    VoD,
    None,
}

#[derive(Clone, Debug)]
pub struct StartAttribute {
    time_offset: Option<f64>,
    precise: bool,
}

// #[derive(Clone, Debug)]
// pub struct ServerControl {
//     can_skip_until: Option<f64>,
//     can_skip_dateranges: bool,
//     hold_back: u32,
//     part_hold_back: Option<u32>,
//     can_block_reload: bool,
// }

#[derive(Clone, Debug)]
pub struct SegmentList {
    pub inner: Vec<SegmentInfo>,
}

#[derive(Debug)]
pub enum MediaPlaylistParsingError {
    UnparsableExtInf,
    UnparsableByteRange,
    UriMissingInMap,
    MissingTargetDuration,
    UriWithoutExtInf,
}

impl fmt::Display for MediaPlaylistParsingError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            MediaPlaylistParsingError::UnparsableExtInf => {
                write!(f, "One of the #EXTINF value could not be parsed")
            }
            MediaPlaylistParsingError::UriMissingInMap => {
                write!(f, "An #EXT-X-MAP was missing its mandatory URI attribute")
            }
            MediaPlaylistParsingError::MissingTargetDuration => {
                write!(f, "Missing mandatory TARGETDURATION attribute")
            }
            MediaPlaylistParsingError::UriWithoutExtInf => {
                write!(f, "One of the uri was not linked to any #EXTINF")
            }
            MediaPlaylistParsingError::UnparsableByteRange => {
                write!(f, "One of the uri had an Unparsable BYTERANGE")
            }
        }
    }
}

impl error::Error for MediaPlaylistParsingError {}

impl MediaPlaylist {
    pub fn create(playlist: impl BufRead, url: Url) -> Result<Self, MediaPlaylistParsingError> {
        let mut version: Option<u32> = None;
        let mut independent_segments = false;
        let mut target_duration: Option<u32> = None;
        let mut media_sequence = 0;
        let mut discontinuity_sequence = 0;
        let mut end_list = false;
        let mut playlist_type = PlaylistType::None;
        let mut i_frames_only = false;
        let mut map: Option<MapInfo> = None;

        let start = StartAttribute {
            time_offset: None,
            precise: false,
        };

        let playlist_base_url = url.pathname();

        let mut curr_start_time = 0.;
        let mut segment_list: Vec<SegmentInfo> = vec![];
        let mut next_segment_duration: Option<f64> = None;
        let mut current_byte: Option<usize> = None;
        let mut next_segment_byte_range: Option<ByteRange> = None;

        let lines = playlist.lines();
        for line in lines {
            let str_line = line.unwrap();
            if str_line.is_empty() {
                continue;
            } else if let Some(stripped) = str_line.strip_prefix("#EXT") {
                let colon_idx = match stripped.find(':') {
                    None => str_line.len(),
                    Some(idx) => idx + 4,
                };

                match &str_line[4..colon_idx] {
                    "-X-VERSION" => match parse_decimal_integer(&str_line, colon_idx + 1).0 {
                        Ok(v) => version = Some(v as u32),
                        Err(_) => Logger::warn("Unparsable VERSION value"),
                    },
                    "-X-TARGETDURATION" => {
                        match parse_decimal_integer(&str_line, colon_idx + 1).0 {
                            Ok(t) => target_duration = Some(t as u32),
                            Err(_) => Logger::warn("Unparsable TARGETDURATION value"),
                        }
                    }
                    "-X-ENDLIST" => end_list = true,
                    "-X-INDEPENDENT-SEGMENTS" => independent_segments = true,
                    "-X-START:" =>
                        /* TODO */
                        {}
                    "INF" => match parse_decimal_floating_point(&str_line, 4 + "INF:".len()).0 {
                        Ok(d) => next_segment_duration = Some(d),
                        Err(_) => return Err(MediaPlaylistParsingError::UnparsableExtInf),
                    },
                    "-X-BYTERANGE" => {
                        match parse_byte_range(&str_line, 5 + "-X-BYTERANGE".len(), current_byte) {
                            Some(br) => {
                                current_byte = Some(br.last_byte + 1);
                                next_segment_byte_range = Some(br);
                            }
                            _ => {
                                return Err(MediaPlaylistParsingError::UnparsableByteRange);
                            }
                        }
                    }
                    "-X-MEDIA-SEQUENCE" => {
                        match parse_decimal_integer(&str_line, colon_idx + 1).0 {
                            Ok(s) => media_sequence = s as u32,
                            Err(_) => Logger::warn("Unparsable MEDIA-SEQUENCE value"),
                        }
                    }
                    "-X-DISCONTINUITY-SEQUENCE" => {
                        match parse_decimal_integer(&str_line, colon_idx + 1).0 {
                            Ok(s) => discontinuity_sequence = s as u32,
                            Err(_) => Logger::warn("Unparsable DISCONTINUITY-SEQUENCE value"),
                        }
                    }
                    "-X-PLAYLIST-TYPE" => match parse_enumerated_string(&str_line, colon_idx + 1).0
                    {
                        "EVENT" => playlist_type = PlaylistType::Event,
                        "VOD" => playlist_type = PlaylistType::VoD,
                        x => {
                            Logger::warn(&format!("Unrecognized playlist type: {}", x));
                            playlist_type = PlaylistType::None;
                        }
                    },
                    "-X-PROGRAM-DATE-TIME" => {
                        if let Some(date) = parse_iso_8601_date(&str_line, colon_idx + 1) {
                            curr_start_time = date;
                        }
                    }
                    "-X-I-FRAMES-ONLY" => i_frames_only = true,
                    "-X-MAP" => {
                        let mut map_info_url: Option<Url> = None;
                        let mut map_info_byte_range: Option<ByteRange> = None;
                        let mut base_offset = colon_idx + 1;
                        loop {
                            if base_offset >= str_line.len() {
                                break;
                            }
                            match str_line[base_offset..].find('=') {
                                None => {
                                    Logger::warn("Attribute Name not followed by equal sign");
                                    break;
                                }
                                Some(idx) => match &str_line[base_offset..base_offset + idx] {
                                    "URI" => {
                                        let (parsed, end_offset) =
                                            parse_quoted_string(&str_line, base_offset + idx + 1);
                                        base_offset = end_offset + 1;
                                        if let Ok(val) = parsed {
                                            let init_url = Url::new(val.to_owned());
                                            let init_url = if init_url.is_absolute() {
                                                init_url
                                            } else {
                                                Url::from_relative(playlist_base_url, init_url)
                                            };
                                            map_info_url = Some(init_url);
                                        }
                                    }

                                    "BYTERANGE" => {
                                        let (parsed, end_offset) =
                                            parse_quoted_string(&str_line, base_offset + idx + 1);
                                        base_offset = end_offset + 1;
                                        if let Ok(val) = parsed {
                                            match parse_byte_range(val, 0, None) {
                                                Some(br) => {
                                                    current_byte = Some(br.last_byte + 1);
                                                    map_info_byte_range = Some(br);
                                                }
                                                _ => return Err(
                                                    MediaPlaylistParsingError::UnparsableByteRange,
                                                ),
                                            };
                                        }
                                    }
                                    _ => {}
                                },
                            }
                        }
                        if let Some(url) = map_info_url {
                            map = Some(MapInfo {
                                uri: url,
                                byte_range: map_info_byte_range,
                            });
                        } else {
                            return Err(MediaPlaylistParsingError::UriMissingInMap);
                        }
                    }
                    "M3U" => {}
                    x => Logger::debug(&format!("Unrecognized tag: \"{}\"", x)),
                }
            } else if str_line.starts_with('#') {
                continue;
            } else {
                // URI
                let seg_url = Url::new(str_line);
                let seg_url = if seg_url.is_absolute() {
                    seg_url
                } else {
                    Url::from_relative(playlist_base_url, seg_url)
                };
                if let Some(duration) = next_segment_duration {
                    let seg = SegmentInfo {
                        start: curr_start_time,
                        duration,
                        byte_range: next_segment_byte_range,
                        url: seg_url,
                    };
                    segment_list.push(seg);
                    curr_start_time += duration;
                    next_segment_duration = None;
                    next_segment_byte_range = None;
                } else {
                    return Err(MediaPlaylistParsingError::UriWithoutExtInf);
                }
            }
        }

        let target_duration = match target_duration {
            Some(target_duration) => target_duration,
            None => return Err(MediaPlaylistParsingError::MissingTargetDuration),
        };
        Ok(MediaPlaylist {
            version,
            independent_segments,
            start,
            target_duration,
            media_sequence,
            discontinuity_sequence,
            end_list,
            playlist_type,
            i_frames_only,
            map,
            segment_list,
            url,
            // TODO
            // server_control,
            // part_inf,
        })
    }

    pub(crate) fn extension(&self) -> Option<&str> {
        self.segment_list.get(0).map(|s| s.url.extension())
    }

    pub(crate) fn target_duration(&self) -> u32 {
        self.target_duration
    }

    pub(crate) fn beginning(&self) -> Option<f64> {
        self.segment_list.first().map(|s| s.start)
    }

    pub(crate) fn duration(&self) -> Option<f64> {
        self.segment_list.last().map(|s| s.start + s.duration)
    }

    /// TODO kind of weird to give the MediaType here
    pub(crate) fn mime_type(&self, media_type: MediaType) -> Option<&str> {
        match media_type {
            MediaType::Audio => match self.extension() {
                Some("mp4") => Some("audio/mp4"),
                Some("mp4a") => Some("audio/mp4"),
                Some("m4s") => Some("audio/mp4"),
                Some("m4i") => Some("audio/mp4"),
                Some("m4a") => Some("audio/mp4"),
                Some("m4f") => Some("audio/mp4"),
                Some("cmfa") => Some("audio/mp4"),
                Some("aac") => Some("audio/aac"),
                Some("ac3") => Some("audio/ac3"),
                Some("ec3") => Some("audio/ec3"),
                Some("mp3") => Some("audio/mpeg"),

                // MPEG2-TS also uses video/ for audio
                Some("ts") => Some("video/mp2t"),
                _ => None,
            },
            MediaType::Video => match self.extension() {
                Some("mp4") => Some("video/mp4"),
                Some("mp4v") => Some("video/mp4"),
                Some("m4s") => Some("video/mp4"),
                Some("m4i") => Some("video/mp4"),
                Some("m4v") => Some("video/mp4"),
                Some("m4f") => Some("video/mp4"),
                Some("cmfv") => Some("video/mp4"),
                Some("ts") => Some("video/mp2t"),
                _ => None,
            },
        }
    }

    pub fn init_segment(&self) -> Option<&MapInfo> {
        self.map.as_ref()
    }

    pub fn last_segment_start(&self) -> Option<f64> {
        match self.end_list {
            false => None,
            true => self.segment_list.last().map(|x| x.start),
        }
    }

    pub fn last_segment_end(&self) -> Option<f64> {
        match self.end_list {
            false => None,
            true => self.segment_list.last().map(|x| x.start + x.duration),
        }
    }

    pub fn first_segment_start(&self) -> Option<f64> {
        self.segment_list.first().map(|x| x.start)
    }

    pub fn first_segment_end(&self) -> Option<f64> {
        self.segment_list.first().map(|x| x.start + x.duration)
    }
}
