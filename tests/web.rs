//! Test suite for the Web and headless browsers.

// #![cfg(target_arch = "wasm32")]


use wasm_bindgen_test::*;





#[cfg(test)]

mod test {

    use wasm_bindgen_test::wasm_bindgen_test;
    wasm_bindgen_test::wasm_bindgen_test_configure!(run_in_browser);
    #[test]
    #[wasm_bindgen_test]
    fn pass() {
        assert_eq!(1 + 1, 2);
    }

}
