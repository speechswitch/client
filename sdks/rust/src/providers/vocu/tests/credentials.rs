use super::*;

const NAMES: [&str; 4] = [
    "SPEECHSWITCH_VOCU_API_KEY",
    "VOCU_API_KEY",
    "SPEECHSWITCH_VOCU_ACCESS_TOKEN",
    "VOCU_ACCESS_TOKEN",
];

#[test]
fn credentials_resolve_once_with_mode_specific_precedence() {
    let missing = "Missing auth.vocu.apiKey configuration";
    let missing_async = "Missing auth.vocu.apiKey or auth.vocu.accessToken configuration";
    let ascii = "Vocu credential must contain only visible ASCII characters";
    let cases = [
        (
            Mode::Stream,
            Some("explicit"),
            Some("session"),
            [
                Some("scoped"),
                Some("key"),
                Some("scoped-token"),
                Some("token"),
            ],
            Ok("explicit"),
        ),
        (
            Mode::Stream,
            None,
            None,
            [Some("scoped"), Some("key"), None, None],
            Ok("scoped"),
        ),
        (
            Mode::Stream,
            None,
            None,
            [None, Some("key"), None, None],
            Ok("key"),
        ),
        (
            Mode::Async,
            None,
            Some("session"),
            [Some("scoped"), None, None, None],
            Ok("session"),
        ),
        (
            Mode::Async,
            Some("explicit"),
            Some("session"),
            [None; 4],
            Ok("explicit"),
        ),
        (
            Mode::Async,
            None,
            None,
            [None, Some("key"), Some("scoped-token"), Some("token")],
            Ok("key"),
        ),
        (
            Mode::Async,
            None,
            None,
            [None, None, Some("scoped-token"), Some("token")],
            Ok("scoped-token"),
        ),
        (
            Mode::Async,
            None,
            None,
            [None, None, None, Some("token")],
            Ok("token"),
        ),
        (
            Mode::Stream,
            None,
            Some("session"),
            [None, None, Some("scoped-token"), Some("token")],
            Err(missing),
        ),
        (
            Mode::Http,
            None,
            Some("session"),
            [None, None, None, Some("token")],
            Err(missing),
        ),
        (Mode::Stream, None, None, [None; 4], Err(missing)),
        (Mode::Async, None, None, [None; 4], Err(missing_async)),
        (
            Mode::Stream,
            Some(""),
            None,
            [Some("scoped"), None, None, None],
            Err(missing),
        ),
        (
            Mode::Async,
            Some(""),
            Some("session"),
            [None; 4],
            Err(missing_async),
        ),
        (
            Mode::Async,
            None,
            Some(""),
            [Some("scoped"), None, None, None],
            Err(missing_async),
        ),
        (
            Mode::Stream,
            None,
            None,
            [Some(""), Some("key"), None, None],
            Err(missing),
        ),
        (
            Mode::Stream,
            Some("Bearer key"),
            None,
            [None; 4],
            Err(ascii),
        ),
        (
            Mode::Stream,
            Some("key\r\ninjected:value"),
            None,
            [None; 4],
            Err(ascii),
        ),
        (Mode::Stream, Some("秘密"), None, [None; 4], Err(ascii)),
        (Mode::Stream, Some("key\0"), None, [None; 4], Err(ascii)),
        (
            Mode::Stream,
            None,
            None,
            [None; 4],
            Err("Invalid Vocu environment credential"),
        ),
    ];
    let child: Option<usize> = std::env::var("SPEECHSWITCH_TEST_VOCU_AUTH")
        .ok()
        .map(|index| index.parse().unwrap());
    for (index, (mode, api_key, access_token, env, expected)) in cases.into_iter().enumerate() {
        if child.is_some_and(|child| child != index) {
            continue;
        }
        // Process-local overrides do not mutate the multithreaded test runner's
        // environment or race other providers' environment readers.
        if child.is_none() {
            let mut command = std::process::Command::new(std::env::current_exe().unwrap());
            command.args(["--exact", "providers::vocu::tests::credentials::credentials_resolve_once_with_mode_specific_precedence", "--nocapture"])
                .env("SPEECHSWITCH_TEST_VOCU_AUTH", index.to_string());
            for (name, value) in NAMES.iter().zip(env) {
                command.env_remove(name);
                if let Some(value) = value {
                    command.env(name, value);
                }
            }
            if expected == Err("Invalid Vocu environment credential") {
                #[cfg(unix)]
                {
                    use std::{ffi::OsString, os::unix::ffi::OsStringExt};
                    command.env(NAMES[0], OsString::from_vec(vec![255]));
                }
                #[cfg(not(unix))]
                continue;
            }
            let result = command.output().unwrap();
            assert_eq!(
                result.status.code(),
                Some(0),
                "case {index}: {}{}",
                String::from_utf8_lossy(&result.stdout),
                String::from_utf8_lossy(&result.stderr)
            );
            continue;
        }
        let mut auth = auth();
        auth.vocu = Some(AuthCartesia {
            api_key: api_key.map(String::from),
            access_token: access_token.map(String::from),
        });
        let responses = if expected.is_err() {
            vec![]
        } else if mode == Mode::Async {
            vec![
                (metadata(r#"{"id":"job","status":"generated","metadata":{"audio":"https://storage.vocu.ai/a.mp3"}}"#).0, false),
                (audio().0, false),
            ]
        } else {
            vec![(audio().0, false)]
        };
        let http = transport(responses);
        let result = ready(synthesize(
            &TtsRequest::TextVoice9c5ed44a(fixtures::plain()),
            &http,
            Options {
                auth: Some(&auth),
                mode: Some(mode),
                ..Default::default()
            },
        ));
        match expected {
            Ok(token) => {
                drop(result.unwrap());
                let requests = http.requests.lock().unwrap();
                assert_eq!(
                    requests[0]
                        .headers
                        .iter()
                        .find(|(key, _)| key == "Authorization")
                        .map(|(_, value)| value.as_str()),
                    Some(format!("Bearer {token}").as_str())
                );
            }
            Err(message) => {
                assert_eq!(result.err().unwrap().to_string(), message);
                assert!(http.requests.lock().unwrap().is_empty());
            }
        }
    }
}
