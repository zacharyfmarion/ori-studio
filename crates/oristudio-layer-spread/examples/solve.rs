//! External-corpus runner: JSON on stdin, solution on stdout. No model assets.
use std::io::{self, Read};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input)?;
    let result = oristudio_layer_spread::solve(&serde_json::from_str(&input)?)?;
    println!("{}", serde_json::to_string(&result)?);
    Ok(())
}
