/**
 * Two inputs a fold brings onto one another, the one that swings first.
 *
 * A sentence names what moves, then what it lands on, because that is what
 * the picture's arrow and the animation move: "Fold P onto Q" over an arrow
 * from Q to P is a caption that disagrees with its card. Which inputs move is
 * decided once, where the picture is drawn (References' `movingInputs`), and
 * every reader of the step takes it from there.
 *
 * `moving` is the indices of the inputs that move; `pair` two inputs in the
 * axiom's own order. The pair comes back as it is unless its second input is
 * the one that moves.
 */
export function moverFirst(
  moving: readonly number[],
  pair: readonly [number, number]
): [number, number] {
  const [first, second] = pair;
  return moving.includes(second) ? [second, first] : [first, second];
}
