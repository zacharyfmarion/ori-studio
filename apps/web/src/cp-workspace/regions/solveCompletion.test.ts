/**
 * The four endings of an accepted solve, and the sentences they earn.
 *
 * The case every assertion here is anchored to is a real one:
 * `test_files/detect-cp/mid-solve_2.osf` — 104 vertices, Kawasaki 14.367° in and
 * 0.00747° out, three odd-degree vertices in and three out, accepted, status
 * `Ambiguous`. The old UI called that "Solved" while the editor showed 70
 * unchanged angle errors.
 *
 * Most blocks below start from a hand-built `CpExactSolveAcceptedOutcome`, which
 * keeps each assertion about one decision. The last block does not: it runs the
 * solver's own JSON through `classifyCpExactSolve` first, because that is the
 * seam where the engine's shape and these sentences meet, and a fixture on both
 * sides of a seam proves nothing about it.
 */
import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";

import type {
  CpExactSolveAcceptedOutcome,
  CpExactSolveResiduals,
  CpExactSolvedGraph,
  CpSolveAngleFamily,
  CpSolvePleats,
} from "../../engine/cpExactSolveTypes";
import {
  classifyCpExactSolve,
  isCpExactSolveAccepted,
} from "../../engine/cpExactSolveTypes";
import {
  CP_FOLDABILITY_CHECK_EPSILON_DEGREES,
  cpSolveCompletion,
  cpSolveMovementSentence,
  cpSolveCompletionDetail,
  cpSolveCompletionFacts,
  cpSolveCompletionHeadline,
  cpSolveIsExactVerdict,
  cpSolveMeetsFoldabilityCheck,
  formatSolveAngleDegrees,
  type CpSolveCompletion,
} from "./solveCompletion";

/**
 * Stands in for i18next: returns the inline English default and interpolates, in
 * both the string and the plural-options forms this module uses. Keeps the
 * assertions about the *wording*, which the i18n:check gate does not cover.
 */
const t = ((key: string, second?: unknown) => {
  if (typeof second === "string") return second;
  const options = (second ?? {}) as Record<string, unknown>;
  const count = options.count as number | undefined;
  const template =
    (count === 1 ? options.defaultValue_one : options.defaultValue_other) ??
    options.defaultValue ??
    key;
  return String(template).replace(/\{\{(\w+)\}\}/gu, (_, name: string) =>
    String(options[name] ?? ""),
  );
}) as unknown as TFunction;

const COMPLETIONS: CpSolveCompletion[] = [
  "exact",
  "approximate",
  "improved",
  "unfoldable",
];

function residuals(
  over: Partial<CpExactSolveResiduals> = {},
): CpExactSolveResiduals {
  return {
    maxKawasakiDegreesBefore: 14.367,
    maxKawasakiDegreesAfter: 0.00747,
    oddDegreeVerticesBefore: 0,
    oddDegreeVerticesAfter: 0,
    bigLittleBigViolationsBefore: 0,
    bigLittleBigViolationsAfter: 0,
    angleViolationsBefore: null,
    angleViolationsAfter: null,
    ...over,
  };
}

function accepted(
  kind: "solved" | "ambiguous",
  figures: CpExactSolveResiduals | null,
): CpExactSolveAcceptedOutcome {
  return {
    kind,
    stage: "refinement",
    movedVertices: [],
    verticesExact: [],
    maxMovement: 0.001,
    elapsedSeconds: 1,
    residuals: figures,
    polishAdopted: false,
  } as CpExactSolveAcceptedOutcome;
}

describe("cpSolveCompletion", () => {
  // Named for what the fixture is, not for the file: `residuals()` defaults to
  // mid-solve_2's *angles* over a clean topology, which is a case the file
  // itself is not — it carries three odd-degree vertices, and the end-to-end
  // block at the bottom pins that. Ambiguous + clean topology is still worth its
  // own assertion: it is the ending where angles are the only thing left.
  it("reads an ambiguous solve over clean topology as improved, not solved", () => {
    expect(cpSolveCompletion(accepted("ambiguous", residuals()))).toBe(
      "improved",
    );
  });

  it("puts an odd-degree vertex ahead of any angle number", () => {
    // The whole reason for the ordering: `analyze_graph` computes no Kawasaki
    // residual for an odd fan, so a pattern can report a perfect angle and still
    // be structurally unfoldable. Angle-first would congratulate the user here.
    const completion = cpSolveCompletion(
      accepted(
        "ambiguous",
        residuals({ maxKawasakiDegreesAfter: 0, oddDegreeVerticesAfter: 3 }),
      ),
    );
    expect(completion).toBe("unfoldable");
  });

  it("puts a big-little-big violation ahead of any angle number", () => {
    // Kawasaki can be exact on a fan that cannot fold: the smallest angle sitting
    // between two creases of the same assignment. The angle number is silent
    // about it, so it has to lead the same way odd degree does.
    const completion = cpSolveCompletion(
      accepted(
        "ambiguous",
        residuals({
          maxKawasakiDegreesAfter: 0,
          bigLittleBigViolationsAfter: 3,
        }),
      ),
    );
    expect(completion).toBe("unfoldable");
  });

  it("does not read an unmeasured big-little-big count as a violation", () => {
    // Null is an older report that did not compute it — not zero, and not three.
    const completion = cpSolveCompletion(
      accepted("ambiguous", residuals({ bigLittleBigViolationsAfter: null })),
    );
    expect(completion).toBe("improved");
  });

  it("separates the solver at 1e-3 from the check at 1e-6", () => {
    // A `solved` verdict only promises `solved_kawasaki_epsilon_degrees` (1e-3),
    // which is a thousand times looser than the bar the editor's own markers are
    // drawn from — so this window is a solve the solver calls exact and the user
    // sees flagged.
    const inWindow = accepted(
      "solved",
      residuals({ maxKawasakiDegreesAfter: 5e-4 }),
    );
    expect(cpSolveCompletion(inWindow)).toBe("approximate");

    const atBar = accepted(
      "solved",
      residuals({
        maxKawasakiDegreesAfter: CP_FOLDABILITY_CHECK_EPSILON_DEGREES,
      }),
    );
    expect(cpSolveCompletion(atBar)).toBe("exact");
  });

  it("falls back to the solver verdict when it reported no figures", () => {
    expect(cpSolveCompletion(accepted("solved", null))).toBe("exact");
    expect(cpSolveCompletion(accepted("ambiguous", null))).toBe("improved");
  });

  it("never treats a missing report as a perfect one", () => {
    // Zeroes would be the tempting default and the worst one: `0` is what a
    // perfect solve reports, so a blank filled in with zeroes reads as exact.
    expect(cpSolveCompletion(accepted("ambiguous", null))).not.toBe("exact");
  });
});

describe("the two predicates", () => {
  it("only lets `exact` claim the check passes", () => {
    const passing = COMPLETIONS.filter(cpSolveMeetsFoldabilityCheck);
    expect(passing).toEqual(["exact"]);
  });

  it("keeps `approximate` on the solver-accepted side of the button gate", () => {
    // Emphasis follows the solver, wording follows the check. `approximate` is
    // the one ending where they disagree, and it is deliberate: the solver found
    // no topology to repair, so pushing the user into the repair flow would be
    // inventing work.
    expect(COMPLETIONS.filter(cpSolveIsExactVerdict)).toEqual([
      "exact",
      "approximate",
    ]);
    expect(cpSolveMeetsFoldabilityCheck("approximate")).toBe(false);
  });
});

describe("formatSolveAngleDegrees", () => {
  it("keeps both ends of the real sentence readable", () => {
    // One sentence spans four orders of magnitude, so a fixed decimal count is
    // either "14.4° to 0.0°" or "14.36700° to 0.00747°".
    expect(formatSolveAngleDegrees(14.367)).toBe("14.4");
    expect(formatSolveAngleDegrees(0.00747)).toBe("0.007");
  });

  it("spells the check bar out rather than in exponent notation", () => {
    expect(formatSolveAngleDegrees(CP_FOLDABILITY_CHECK_EPSILON_DEGREES)).toBe(
      "0.000001",
    );
    expect(formatSolveAngleDegrees(0.000795)).toBe("0.0008");
  });

  it("renders nothing-left as 0 rather than a row of zeroes", () => {
    expect(formatSolveAngleDegrees(0)).toBe("0");
    expect(formatSolveAngleDegrees(1e-12)).toBe("0");
    expect(formatSolveAngleDegrees(Number.NaN)).toBe("0");
  });
});

describe("cpSolveCompletionHeadline", () => {
  it("gives each ending its own sentence, and only one of them says Solved alone", () => {
    const headlines = COMPLETIONS.map((completion) =>
      cpSolveCompletionHeadline(t, completion),
    );
    expect(new Set(headlines).size).toBe(4);
    expect(cpSolveCompletionHeadline(t, "exact")).toBe("Solved");
    for (const completion of ["improved", "unfoldable"] as const) {
      expect(cpSolveCompletionHeadline(t, completion)).toContain("Improved");
    }
  });
});

describe("cpSolveCompletionDetail", () => {
  it("quotes both residuals and the bar they are measured against", () => {
    const detail = cpSolveCompletionDetail(t, {
      completion: "improved",
      residuals: residuals(),
    });

    expect(detail).toContain("14.4°");
    expect(detail).toContain("0.007°");
    expect(detail).toContain("0.000001°");
  });

  it("says how many vertices still miss the angle bar, which is what the user will see marked", () => {
    const detail = cpSolveCompletionDetail(t, {
      completion: "improved",
      residuals: residuals({
        maxKawasakiDegreesAfter: 0.0119,
        angleViolationsAfter: 241,
      }),
    });
    expect(detail).toContain("to 0.01°");
    expect(detail).toContain("which 241 vertices still miss");
    expect(detail).not.toContain("which passes");
  });

  it("keeps the bare angle sentence when the report carries no count", () => {
    const detail = cpSolveCompletionDetail(t, {
      completion: "improved",
      residuals: residuals({
        maxKawasakiDegreesAfter: 0.0119,
        angleViolationsAfter: null,
      }),
    });
    expect(detail).toMatch(/and the check needs it below 0\.000001°\.$/);
  });

  it("leads with the odd-degree cause, because that is the actionable one", () => {
    const detail = cpSolveCompletionDetail(t, {
      completion: "unfoldable",
      residuals: residuals({ oddDegreeVerticesAfter: 3 }),
    });

    expect(
      detail.startsWith("3 vertices still have an odd number of creases"),
    ).toBe(true);
    expect(detail).toContain("no matter where the vertices sit");
    // And still says what the solve did, because a user who repairs those three
    // needs to know the angles came 1,900x closer rather than not at all.
    expect(detail).toContain("14.4°");
  });

  it("leads with the big-little-big cause when that is what remains", () => {
    const detail = cpSolveCompletionDetail(t, {
      completion: "unfoldable",
      residuals: residuals({ bigLittleBigViolationsAfter: 3 }),
    });

    expect(
      detail.startsWith(
        "At 3 vertices the smallest angle sits between two creases",
      ),
    ).toBe(true);
    // No odd-degree sentence for a count of zero: "0 vertices still have an odd
    // number of creases" is exactly the noise a joined sentence must not say.
    expect(detail).not.toContain("odd number of creases");
    expect(detail).toContain("14.4°");
  });

  it("names both causes when both remain, odd degree first", () => {
    const detail = cpSolveCompletionDetail(t, {
      completion: "unfoldable",
      residuals: residuals({
        oddDegreeVerticesAfter: 2,
        bigLittleBigViolationsAfter: 1,
      }),
    });

    expect(
      detail.startsWith("2 vertices still have an odd number of creases"),
    ).toBe(true);
    expect(detail).toContain(
      "At 1 vertex the smallest angle sits between two creases",
    );
  });

  it("agrees with itself on one odd vertex", () => {
    const detail = cpSolveCompletionDetail(t, {
      completion: "unfoldable",
      residuals: residuals({ oddDegreeVerticesAfter: 1 }),
    });
    expect(detail).toContain("1 vertex still has an odd number of creases");
  });

  it("defers to the shared table when there are no numbers to quote", () => {
    // Numbers when the solver reported them, `cpExactSolveMessages` when it did
    // not — rather than a second wordless version of the same idea here.
    const detail = cpSolveCompletionDetail(t, {
      completion: "improved",
      residuals: null,
    });
    expect(detail).toContain(
      "not close enough for the pattern to pass the foldability check",
    );
  });

  it("is the only ending allowed to say the check passes", () => {
    const exact = cpSolveCompletionDetail(t, {
      completion: "exact",
      residuals: residuals(),
    });
    expect(exact).toBe("The pattern now meets the foldability check.");
    for (const completion of [
      "approximate",
      "improved",
      "unfoldable",
    ] as const) {
      const detail = cpSolveCompletionDetail(t, {
        completion,
        residuals: residuals(),
      });
      expect(detail).not.toContain("now meets");
    }
  });
});

describe("cpSolveMovementSentence", () => {
  it("rounds the worst movement up, so the claim it makes stays true", () => {
    // 0.42 px reads "under 1 px", never "under 0.4 px" that a later measurement
    // could contradict.
    expect(
      cpSolveMovementSentence(t, { movedVertices: 45, maxMovementPx: 0.42 }),
    ).toBe("It moved 45 vertices, each by under 1 px.");
  });

  it("agrees with itself on one moved vertex", () => {
    expect(
      cpSolveMovementSentence(t, { movedVertices: 1, maxMovementPx: 2.1 }),
    ).toBe("It moved 1 vertex, by under 3 px.");
  });
});

/**
 * The whole chain, from the JSON the solver actually emits.
 *
 * Every other assertion in this file starts from a hand-built
 * `CpExactSolveAcceptedOutcome`, and the engine's own tests stop at producing
 * one — so the two halves meet at a fixture, and a disagreement between them
 * would leave both green while the product lied. These run
 * `classifyCpExactSolve` over a real `ExactSolvedGraph` and assert on the
 * sentences a user reads.
 *
 * The figures are `test_files/detect-cp/mid-solve_2.osf`'s: accepted, status
 * `Ambiguous`, Kawasaki 14.367° -> 0.00747°, three odd-degree vertices in and
 * three out. That is the file the old UI called "Solved" over 70 unchanged
 * angle-error markers.
 */
describe("mid-solve_2.osf, end to end from the solver payload", () => {
  function midSolve2(): CpExactSolvedGraph {
    return {
      schema: "exact_solved_graph@1",
      vertices_exact: [],
      edges_exact: [],
      status: "ambiguous",
      movement_report: {
        schema: "movement_report@1",
        termination: "sparse_ftol",
        accepted: true,
        rejection_reasons: [],
        max_vertex_movement: 0.42,
        elapsed_seconds: 3.1,
        moved_vertices: [],
        // A polish round was computed and thrown away — the shape agent 3's
        // Rust change added, and the reason `polishAdopted` is false here
        // despite the loop having run.
        polish: {
          enabled: true,
          ran: true,
          stop_reason: "round_refused",
          rounds_attempted: 1,
          rounds_adopted: 0,
          max_rounds: 6,
          target_kawasaki_degrees: 1e-3,
          kawasaki_before_degrees: 0.00747,
          kawasaki_after_degrees: 0.00747,
          refused_round: {
            kawasaki_degrees: 8e-4,
            kawasaki_regressed: false,
            rejection_reasons: [
              "candidate_status_failed",
              "movement_budget_exceeded",
            ],
          },
        },
      },
      theorem_residual_report: {
        schema: "theorem_residual_report@1",
        accepted: true,
        before: {
          max_kawasaki_residual_degrees: 14.367,
          odd_degree_vertices: [17, 42, 88],
        },
        after: {
          max_kawasaki_residual_degrees: 0.00747,
          odd_degree_vertices: [17, 42, 88],
        },
      },
    } as unknown as CpExactSolvedGraph;
  }

  it("classifies the payload as accepted but ambiguous", () => {
    const outcome = classifyCpExactSolve(midSolve2(), "refinement");
    expect(outcome.kind).toBe("ambiguous");
    expect(isCpExactSolveAccepted(outcome)).toBe(true);
  });

  it("carries the solver figures through instead of recomputing them", () => {
    const outcome = classifyCpExactSolve(midSolve2(), "refinement");
    expect(isCpExactSolveAccepted(outcome) && outcome.residuals).toEqual({
      maxKawasakiDegreesBefore: 14.367,
      maxKawasakiDegreesAfter: 0.00747,
      oddDegreeVerticesBefore: 3,
      oddDegreeVerticesAfter: 3,
      bigLittleBigViolationsBefore: null,
      bigLittleBigViolationsAfter: null,
      angleViolationsBefore: null,
      angleViolationsAfter: null,
    });
  });

  it("reports a refused polish round as not adopted, from the count", () => {
    // No `+polish(rounds=N)` suffix on `termination` either, so this agrees with
    // the string fallback — the point is that the count is what was read.
    const outcome = classifyCpExactSolve(midSolve2(), "refinement");
    expect(isCpExactSolveAccepted(outcome) && outcome.polishAdopted).toBe(
      false,
    );
  });

  it("lands on unfoldable, and never says Solved", () => {
    const outcome = classifyCpExactSolve(midSolve2(), "refinement");
    if (!isCpExactSolveAccepted(outcome))
      throw new Error("expected an accepted outcome");

    const facts = cpSolveCompletionFacts(outcome);
    expect(facts.completion).toBe("unfoldable");
    expect(cpSolveMeetsFoldabilityCheck(facts.completion)).toBe(false);
    expect(cpSolveIsExactVerdict(facts.completion)).toBe(false);

    const headline = cpSolveCompletionHeadline(t, facts.completion);
    expect(headline).toBe("Improved, but this pattern cannot fold flat");
    expect(headline).not.toMatch(/^Solved/u);
  });

  it("names the three vertices the user has to repair", () => {
    const outcome = classifyCpExactSolve(midSolve2(), "refinement");
    if (!isCpExactSolveAccepted(outcome))
      throw new Error("expected an accepted outcome");
    const facts = cpSolveCompletionFacts(outcome);

    const detail = cpSolveCompletionDetail(t, facts);
    expect(detail).toContain("3 vertices still have an odd number of creases");
    // The angle improvement is real and is still reported — the topology
    // sentence leads, it does not replace it.
    expect(detail).toContain("from 14.4° to 0.007°");
    expect(detail).toContain("below 0.000001°");
  });
});

describe("cpSolveCompletionDetail — the angle sentence", () => {
  it("does not quote the bar once the angle passes it", () => {
    const detail = cpSolveCompletionDetail(t, {
      completion: "unfoldable",
      residuals: residuals({
        maxKawasakiDegreesAfter: 6e-7,
        bigLittleBigViolationsAfter: 2,
      }),
      angleFamily: null,
    });
    expect(detail).toContain("which passes the check");
    expect(detail).not.toContain("needs it below");
  });

  it("still quotes the bar while the angle is what fails", () => {
    const detail = cpSolveCompletionDetail(t, {
      completion: "unfoldable",
      residuals: residuals({ bigLittleBigViolationsAfter: 2 }),
      angleFamily: null,
    });
    expect(detail).toContain("needs it below 0.000001°");
  });
});

describe("cpSolveCompletionDetail — the grid snap", () => {
  // Four big-little-big violations remain, so the snap is the next thing to say.
  const remaining = () => residuals({ bigLittleBigViolationsAfter: 4 });
  function family(over: Partial<CpSolveAngleFamily> = {}): CpSolveAngleFamily {
    return {
      stepDegrees: 22.5,
      adopted: false,
      stopReason: "refused",
      refusals: [
        "pinned_kawasaki_regressed",
        "pinned_angle_violations_increased",
      ],
      verticesOverBar: 33,
      ...over,
    };
  }

  it("says when there was no grid to snap to", () => {
    const detail = cpSolveCompletionDetail(t, {
      completion: "unfoldable",
      residuals: remaining(),
      angleFamily: null,
    });
    expect(detail).toContain(
      "Fewer than half the creases sit near a 15°, 22.5°, 30° or 45° grid",
    );
  });

  it("says the snap was refused for breaking vertices, with their count", () => {
    const detail = cpSolveCompletionDetail(t, {
      completion: "unfoldable",
      residuals: remaining(),
      angleFamily: family(),
    });
    expect(detail).toContain(
      "Snapping the creases to the 22.5° grid was tried and refused because 33 vertices could not stay flat-foldable on it.",
    );
    // Still leads with the cause, and still quotes the angles.
    expect(detail.startsWith("At 4 vertices the smallest angle")).toBe(true);
    expect(detail).toContain("14.4°");
  });

  it("says the snap was refused for moving vertices too far", () => {
    const detail = cpSolveCompletionDetail(t, {
      completion: "unfoldable",
      residuals: remaining(),
      angleFamily: family({
        refusals: ["candidate_status_failed", "movement_budget_exceeded"],
        verticesOverBar: 0,
      }),
    });
    expect(detail).toContain("would have moved vertices too far");
  });

  it("says what remains is off the grid when the snap landed", () => {
    const detail = cpSolveCompletionDetail(t, {
      completion: "unfoldable",
      residuals: remaining(),
      angleFamily: family({
        adopted: true,
        stopReason: "adopted",
        refusals: [],
        verticesOverBar: 0,
      }),
    });
    expect(detail).toContain(
      "were snapped to it; what remains is at creases that are not on it",
    );
  });

  it("writes a 45° grid without a decimal", () => {
    const detail = cpSolveCompletionDetail(t, {
      completion: "unfoldable",
      residuals: remaining(),
      angleFamily: family({
        stepDegrees: 45,
        adopted: true,
        stopReason: "adopted",
        refusals: [],
      }),
    });
    expect(detail).toContain("the 45° grid");
    expect(detail).not.toContain("45.0");
  });

  it("says nothing about the grid when no big-little-big violation remains", () => {
    const detail = cpSolveCompletionDetail(t, {
      completion: "unfoldable",
      residuals: residuals({ oddDegreeVerticesAfter: 2 }),
      angleFamily: family(),
    });
    expect(detail).not.toContain("grid");
  });
});

describe("cpSolveCompletionDetail — the pleat round", () => {
  const pleats = (over: Partial<CpSolvePleats> = {}): CpSolvePleats => ({
    adopted: true,
    stopReason: "adopted",
    runs: 2,
    creases: 36,
    ties: 31,
    spreadBeforePct: 1.4,
    spreadAfterPct: 0,
    refusals: [],
    ...over,
  });

  it("says what was held, after the completion sentence", () => {
    const detail = cpSolveCompletionDetail(t, {
      completion: "exact",
      residuals: null,
      angleFamily: null,
      pleats: pleats(),
    });
    expect(detail).toBe(
      "The pattern now meets the foldability check. The 36 creases of 2 pleat runs were held to equal spacing.",
    );
    expect(
      cpSolveCompletionDetail(t, {
        completion: "exact",
        residuals: null,
        angleFamily: null,
        pleats: pleats({ runs: 1, creases: 30 }),
      }),
    ).toContain("The 30 creases of 1 pleat run were held");
  });

  it("is silent with no pleats, and with nothing to hold", () => {
    const exact = "The pattern now meets the foldability check.";
    for (const value of [
      null,
      undefined,
      pleats({ ties: 0, stopReason: "nothing_to_tie" }),
    ]) {
      expect(
        cpSolveCompletionDetail(t, {
          completion: "exact",
          residuals: null,
          angleFamily: null,
          pleats: value,
        }),
      ).toBe(exact);
    }
  });

  it("says when the round was tried and refused", () => {
    const detail = cpSolveCompletionDetail(t, {
      completion: "improved",
      residuals: null,
      angleFamily: null,
      pleats: pleats({
        adopted: false,
        stopReason: "refused",
        refusals: ["pinned_kawasaki_regressed"],
      }),
    });
    expect(detail).toContain(
      "Evening out the pleat spacing was tried and refused",
    );
  });
});
