import origami.crease_pattern.CustomLineTypes;
import origami.Epsilon;
import origami.crease_pattern.FlatFoldabilityViolation;
import origami.crease_pattern.FoldLineSet;
import origami.crease_pattern.LassoInteractionMode;
import origami.crease_pattern.LittleBigLittleViolation;
import origami.crease_pattern.LineSegmentSet;
import origami.crease_pattern.OritaCalc;
import origami.crease_pattern.PointLineMap;
import origami.crease_pattern.PointSet;
import origami.crease_pattern.element.Circle;
import origami.crease_pattern.element.LineColor;
import origami.crease_pattern.element.LineSegment;
import origami.crease_pattern.element.Point;
import origami.crease_pattern.element.Polygon;
import origami.crease_pattern.element.StraightLine;
import origami.crease_pattern.util.CreasePattern_Worker_Toolbox;
import origami.crease_pattern.worker.foldlineset.BranchTrim;
import origami.crease_pattern.worker.foldlineset.Check1;
import origami.crease_pattern.worker.foldlineset.Check2;
import origami.crease_pattern.worker.foldlineset.Check3;
import origami.crease_pattern.worker.foldlineset.Check4;
import origami.crease_pattern.worker.foldlineset.Fix1;
import origami.crease_pattern.worker.foldlineset.Fix2;
import origami.crease_pattern.worker.foldlineset.OrganizeCircles;
import origami.crease_pattern.worker.FoldedFigure_Configurator;
import origami.crease_pattern.worker.FoldedFigure_Worker;
import origami.crease_pattern.worker.LineSegmentSetWorker;
import origami.crease_pattern.worker.WireFrame_Worker;
import origami.crease_pattern.worker.linesegmentset.IntersectDivide;
import origami.crease_pattern.worker.SelectMode;
import origami.folding.HierarchyList;
import origami.folding.FoldedFigure;
import origami.folding.algorithm.SubFacePriority;
import origami.folding.algorithm.swapping.SubFaceSwappingAlgorithm;
import origami.folding.element.SubFace;
import origami.folding.permutation.ChainPermutationGenerator;
import origami.folding.util.IBulletinBoard;
import origami.folding.util.SortingBox;

import oriedita.editor.databinding.GridModel;
import oriedita.editor.databinding.FoldedFigureModel;
import oriedita.editor.drawing.FoldedFigure_Drawer;
import oriedita.editor.drawing.tools.Camera;
import oriedita.editor.export.DxfExporter;
import oriedita.editor.export.ObjImporter;
import oriedita.editor.export.OrhExporter;
import oriedita.editor.export.OrhImporter;
import oriedita.editor.folded_figure.FoldedFigure_01;
import oriedita.editor.canvas.OperationFrame;
import oriedita.editor.save.Save;
import oriedita.editor.save.SaveProvider;
import oriedita.editor.text.Text;

import java.awt.Color;
import java.awt.Rectangle;
import java.awt.geom.Path2D;
import java.io.File;
import java.io.IOException;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.DoubleBuffer;
import java.nio.file.Files;
import java.util.Collection;
import java.util.HashSet;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class OrieditaGeometryOracle {
    private static final String JSON_NUMBER = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[Ee][+-]?\\d+)?";

    private static class AngleRestrictedConvergingCandidates {
        final List<LineSegment> indicators;
        final List<Point> intersections;

        AngleRestrictedConvergingCandidates(List<LineSegment> indicators, List<Point> intersections) {
            this.indicators = indicators;
            this.intersections = intersections;
        }
    }

    private static class LineSegmentPair {
        final LineSegment first;
        final LineSegment second;

        LineSegmentPair(LineSegment first, LineSegment second) {
            this.first = first;
            this.second = second;
        }
    }

    private static class NoopBulletinBoard implements IBulletinBoard {
        @Override
        public void rewrite(int i, String s) {
        }

        @Override
        public void write(String s) {
        }

        @Override
        public void clear() {
        }
    }

    private enum OperationFrameOracleMode {
        NONE_0,
        CREATE_1,
        MOVE_POINTS_2,
        MOVE_SIDES_3,
        MOVE_BOX_4,
    }

    private static class OracleVoronoiState {
        List<OracleVoronoiLineSegment> lineSegments = new ArrayList<>();
        final List<OracleVoronoiLineSegment> linesAroundNewPoint = new ArrayList<>();
        final List<Point> seedPoints = new ArrayList<>();

        void reset() {
            lineSegments.clear();
            linesAroundNewPoint.clear();
            seedPoints.clear();
        }
    }

    private static class OracleVoronoiLineSegment {
        int voronoiA;
        int voronoiB;
        LineSegment lineSegment;
        int selected;

        OracleVoronoiLineSegment(LineSegment lineSegment) {
            this.lineSegment = lineSegment;
            this.voronoiA = 0;
            this.voronoiB = 0;
            this.selected = 0;
        }

        OracleVoronoiLineSegment(OracleVoronoiLineSegment source) {
            this.lineSegment = source.lineSegment;
            this.voronoiA = source.voronoiA;
            this.voronoiB = source.voronoiB;
            this.selected = source.selected;
        }

        OracleVoronoiLineSegment withA(Point a) {
            OracleVoronoiLineSegment line = new OracleVoronoiLineSegment(this.lineSegment.withA(a));
            line.voronoiA = voronoiA;
            line.voronoiB = voronoiB;
            return line;
        }

        OracleVoronoiLineSegment withB(Point b) {
            OracleVoronoiLineSegment line = new OracleVoronoiLineSegment(this.lineSegment.withB(b));
            line.voronoiA = voronoiA;
            line.voronoiB = voronoiB;
            return line;
        }
    }

    private static class OracleTextState {
        int selected = -1;
        boolean isSelected = false;
        boolean dirty = false;
        Point selectionStart = null;
    }

    private enum OracleFixerType {
        BP, PURE_22_5, OTHER, EMPTY
    }

    private static class OracleFixerResult {
        long numFixedLines;
        long numFixableLines;
        ArrayList<Double> lines;
        OracleFixerType type;

        OracleFixerResult(long numFixedLines, long numFixableLines, ArrayList<Double> lines, OracleFixerType type) {
            this.numFixedLines = numFixedLines;
            this.numFixableLines = numFixableLines;
            this.lines = lines;
            this.type = type;
        }
    }

    private static class OracleFixXform {
        boolean isSquare;
        boolean inDefaultSquare;
        double scale;
        double deltaX;
        double deltaY;

        OracleFixXform(boolean isSquare, boolean inDefaultSquare, double scale, double deltaX, double deltaY) {
            this.isSquare = isSquare;
            this.inDefaultSquare = inDefaultSquare;
            this.scale = scale;
            this.deltaX = deltaX;
            this.deltaY = deltaY;
        }
    }

    public static void main(String[] args) throws Exception {
        if (args.length < 1) {
            usage("missing command");
        }

        switch (args[0]) {
            case "intersection" -> intersection(args);
            case "intersect-divide" -> intersectDivide(args);
            case "intersect-divide-pair" -> intersectDividePair(args);
            case "foldline-divide-new-lines" -> foldLineDivideNewLines(args);
            case "foldline-divide-fast" -> foldLineDivideFast(args);
            case "foldline-delete-inside" -> foldLineDeleteInside(args);
            case "foldline-delete-line-vertex" -> foldLineDeleteLineVertex(args);
            case "foldline-delete-lines" -> foldLineDeleteLines(args);
            case "foldline-branch-trim" -> foldLineBranchTrim(args);
            case "foldline-check1" -> foldLineCheck1(args);
            case "foldline-check2" -> foldLineCheck2(args);
            case "foldline-check3" -> foldLineCheck3(args);
            case "foldline-check4" -> foldLineCheck4(args);
            case "check-camv-task" -> checkCamvTask(args);
            case "foldline-del-v" -> foldLineDelV(args);
            case "foldline-del-v-cc" -> foldLineDelVCc(args);
            case "foldline-del-v-pair" -> foldLineDelVPair(args);
            case "foldline-del-v-all" -> foldLineDelVAll(args);
            case "foldline-del-v-all-cc" -> foldLineDelVAllCc(args);
            case "foldline-fix1" -> foldLineFix1(args);
            case "foldline-fix2" -> foldLineFix2(args);
            case "foldline-fix-inaccurate" -> foldLineFixInaccurate(args);
            case "foldline-set-color" -> foldLineSetColor(args);
            case "foldline-change-type" -> foldLineChangeType(args);
            case "foldline-make-color" -> foldLineMakeColor(args);
            case "foldline-make-aux" -> foldLineMakeAux(args);
            case "foldline-change-mv" -> foldLineChangeMv(args);
            case "foldline-advance-type" -> foldLineAdvanceType(args);
            case "foldline-alternate-mv" -> foldLineAlternateMv(args);
            case "foldline-alternate-mv-crossing" -> foldLineAlternateMvCrossing(args);
            case "foldline-select-all" -> foldLineSelectAll(args);
            case "foldline-select-indices" -> foldLineSelectIndices(args);
            case "foldline-select-box" -> foldLineSelectBox(args);
            case "foldline-select-polygon" -> foldLineSelectPolygon(args);
            case "foldline-select-lasso" -> foldLineSelectLasso(args);
            case "foldline-select-lx" -> foldLineSelectLx(args);
            case "foldline-select-connected" -> foldLineSelectConnected(args);
            case "foldline-delete-selected" -> foldLineDeleteSelected(args);
            case "foldline-replace-type" -> foldLineReplaceType(args);
            case "foldline-delete-type" -> foldLineDeleteType(args);
            case "foldline-translate" -> foldLineTranslate(args);
            case "foldline-transform-selected" -> foldLineTransformSelected(args);
            case "foldline-transform-selected-4p" -> foldLineTransformSelected4p(args);
            case "operation-frame-sequence" -> operationFrameSequence(args);
            case "foldline-extend-to-intersection" -> foldLineExtendToIntersection(args);
            case "foldline-lengthen" -> foldLineLengthen(args);
            case "foldline-parallel-draw" -> foldLineParallelDraw(args);
            case "foldline-parallel-width" -> foldLineParallelWidth(args);
            case "foldline-perpendicular-projection" -> foldLinePerpendicularProjection(args);
            case "foldline-perpendicular-indicator" -> foldLinePerpendicularIndicator(args);
            case "foldline-axiom5-indicator" -> foldLineAxiom5Indicator(args);
            case "foldline-axiom5-commit" -> foldLineAxiom5Commit(args);
            case "foldline-axiom5-destination" -> foldLineAxiom5Destination(args);
            case "foldline-axiom7-indicator" -> foldLineAxiom7Indicator(args);
            case "foldline-axiom7-commit" -> foldLineAxiom7Commit(args);
            case "foldline-axiom7-destination" -> foldLineAxiom7Destination(args);
            case "foldline-symmetric-draw" -> foldLineSymmetricDraw(args);
            case "foldline-double-symmetric-draw" -> foldLineDoubleSymmetricDraw(args);
            case "foldline-continuous-symmetric-draw" -> foldLineContinuousSymmetricDraw(args);
            case "foldline-inward" -> foldLineInward(args);
            case "foldline-fishbone" -> foldLineFishbone(args);
            case "foldline-angle-restricted5" -> foldLineAngleRestricted5(args);
            case "foldline-angle-restricted3-candidates" -> foldLineAngleRestricted3Candidates(args);
            case "foldline-angle-restricted3-draw" -> foldLineAngleRestricted3Draw(args);
            case "foldline-angle-restricted-converging-candidates" -> foldLineAngleRestrictedConvergingCandidates(args);
            case "foldline-angle-restricted-converging-draw" -> foldLineAngleRestrictedConvergingDraw(args);
            case "foldline-angle-system-candidates" -> foldLineAngleSystemCandidates(args);
            case "foldline-angle-system-draw" -> foldLineAngleSystemDraw(args);
            case "foldline-make-vertex-flat-foldable-candidates" -> foldLineMakeVertexFlatFoldableCandidates(args);
            case "foldline-make-vertex-flat-foldable-destination" -> foldLineMakeVertexFlatFoldableDestination(args);
            case "foldline-foldable-input-candidates" -> foldLineFoldableInputCandidates(args);
            case "foldline-foldable-input-direct" -> foldLineFoldableInputDirect(args);
            case "foldline-foldable-input-destination" -> foldLineFoldableInputDestination(args);
            case "foldline-foldable-draw-mode" -> foldLineFoldableDrawMode(args);
            case "foldline-foldable-draw-switch" -> foldLineFoldableDrawSwitch(args);
            case "foldline-square-bisector-3p" -> foldLineSquareBisector3p(args);
            case "foldline-square-bisector-2l-np" -> foldLineSquareBisector2lNp(args);
            case "foldline-square-bisector-parallel-indicator" -> foldLineSquareBisectorParallelIndicator(args);
            case "foldline-square-bisector-parallel-commit" -> foldLineSquareBisectorParallelCommit(args);
            case "foldline-square-bisector-parallel-between" -> foldLineSquareBisectorParallelBetween(args);
            case "foldline-draw-crease" -> foldLineDrawCrease(args);
            case "foldline-draw-symmetric" -> foldLineDrawSymmetric(args);
            case "foldline-draw-point" -> foldLineDrawPoint(args);
            case "foldline-circle-draw" -> foldLineCircleDraw(args);
            case "foldline-circle-draw-free" -> foldLineCircleDrawFree(args);
            case "foldline-circle-three-point" -> foldLineCircleThreePoint(args);
            case "foldline-circle-separate" -> foldLineCircleSeparate(args);
            case "foldline-circle-concentric" -> foldLineCircleConcentric(args);
            case "foldline-circle-concentric-select" -> foldLineCircleConcentricSelect(args);
            case "foldline-circle-concentric-two" -> foldLineCircleConcentricTwo(args);
            case "foldline-circle-invert-circle" -> foldLineCircleInvertCircle(args);
            case "foldline-circle-invert-line" -> foldLineCircleInvertLine(args);
            case "foldline-circle-organize" -> foldLineCircleOrganize(args);
            case "foldline-circle-change-color" -> foldLineCircleChangeColor(args);
            case "foldline-circle-tangent-point" -> foldLineCircleTangentPoint(args);
            case "foldline-circle-tangent-two" -> foldLineCircleTangentTwo(args);
            case "foldline-regular-polygon" -> foldLineRegularPolygon(args);
            case "foldline-voronoi" -> foldLineVoronoi(args);
            case "foldline-default-molecule" -> foldLineDefaultMolecule(args);
            case "flat-foldable-boundary-check" -> flatFoldableBoundaryCheck(args);
            case "text-sequence" -> textSequence(args);
            case "foldline-divide-count" -> foldLineDivideCount(args);
            case "foldline-divide-ratio" -> foldLineDivideRatio(args);
            case "measure-length" -> measureLength(args);
            case "measure-angle" -> measureAngle(args);
            case "custom-line-type" -> customLineType(args);
            case "orh-import-summary" -> orhImportSummary(args);
            case "orh-export-fixture" -> orhExportFixture(args);
            case "obj-import-summary" -> objImportSummary(args);
            case "dxf-export-fixture" -> dxfExportFixture(args);
            case "fold-topology-summary" -> foldTopologySummary(args);
            case "wireframe-folding-summary" -> wireframeFoldingSummary(args);
            case "split-subface-arrangement" -> splitSubfaceArrangement(args);
            case "two-colored-subface-arrangement" -> twoColoredSubfaceArrangement(args);
            case "two-colored-estimate-summary" -> twoColoredEstimateSummary(args);
            case "subface-configuration-summary" -> subfaceConfigurationSummary(args);
            case "initial-hierarchy-summary" -> initialHierarchySummary(args);
            case "equivalence-candidates-summary" -> equivalenceCandidatesSummary(args);
            case "additional-estimation-summary" -> additionalEstimationSummary(args);
            case "folding-estimate-summary" -> foldingEstimateSummary(args);
            case "folding-estimate-sequence-summary" -> foldingEstimateSequenceSummary(args);
            case "folding-estimate-specific-summary" -> foldingEstimateSpecificSummary(args);
            case "folding-estimate-save-batch-summary" -> foldingEstimateSaveBatchSummary(args);
            case "folding-estimate-case-filename" -> foldingEstimateCaseFilename(args);
            case "duplicate-estimation-order" -> duplicateEstimationOrder(args);
            case "chain-permutation-summary" -> chainPermutationSummary(args);
            case "chain-permutation-temp-summary" -> chainPermutationTempSummary(args);
            case "subface-guide-permutation-summary" -> subfaceGuidePermutationSummary(args);
            case "subface-overlap-search-summary" -> subfaceOverlapSearchSummary(args);
            case "subface-priority-summary" -> subfacePrioritySummary(args);
            case "worker-overlap-search-summary" -> workerOverlapSearchSummary(args, false);
            case "worker-overlap-search-swap-summary" -> workerOverlapSearchSummary(args, true);
            case "worker-overlap-ordered-summary" -> workerOverlapOrderedSummary(args);
            case "worker-overlap-ordered-sequence-summary" -> workerOverlapOrderedSequenceSummary(args);
            case "worker-overlap-from-segments-summary" -> workerOverlapFromSegmentsSummary(args, false);
            case "worker-overlap-from-segments-swap-summary" -> workerOverlapFromSegmentsSummary(args, true);
            case "subface-swapper-summary" -> subfaceSwapperSummary(args);
            case "folded-render-paper-front" -> foldedRenderPaper(args, FoldedFigure.State.FRONT_0, "paper-front");
            case "folded-render-paper-back" -> foldedRenderPaper(args, FoldedFigure.State.BACK_1, "paper-back");
            case "folded-render-paper-both" -> foldedRenderPaper(args, FoldedFigure.State.BOTH_2, "paper-both");
            default -> usage("unknown command: " + args[0]);
        }
    }

    private static void foldedRenderPaper(String[] args, FoldedFigure.State state, String pass) throws Exception {
        if (args.length != 2) {
            usage(args[0] + " expects a fixture name");
        }

        String fixture = args[1];
        FoldedFigure_Drawer drawer = foldedRenderDrawer(fixture, state);
        RecordingGraphics2D graphics = new RecordingGraphics2D(800, 600);
        drawer.foldUp_draw(graphics, false, 1, true);

        System.out.println("schema|folded-render-primitives|1");
        System.out.println("fixture|" + fixture + "|" + pass);
        for (String record : graphics.records()) {
            System.out.println(record);
        }
        graphics.dispose();
    }

    private static FoldedFigure_Drawer foldedRenderDrawer(
            String fixture,
            FoldedFigure.State state) throws Exception {
        LineSegmentSet set = foldedRenderFixture(fixture);
        FoldedFigure_01 foldedFigure = new FoldedFigure_01(new NoopBulletinBoard());
        FoldedFigure_Drawer drawer = new FoldedFigure_Drawer(foldedFigure);
        FoldedFigureModel model = new FoldedFigureModel();
        model.setState(state);
        drawer.setData(model);
        drawer.setEstimationOrder(FoldedFigure.EstimationOrder.ORDER_5);
        drawer.folding_estimated(new Camera(), set);
        return drawer;
    }

    private static LineSegmentSet foldedRenderFixture(String fixture) {
        if (!fixture.equals("simple-square")) {
            throw new IllegalArgumentException("unknown folded render fixture: " + fixture);
        }

        LineSegmentSet set = new LineSegmentSet();
        set.addLine(new Point(-50.0, -50.0), new Point(50.0, -50.0), LineColor.BLACK_0);
        set.addLine(new Point(50.0, -50.0), new Point(50.0, 50.0), LineColor.BLACK_0);
        set.addLine(new Point(50.0, 50.0), new Point(-50.0, 50.0), LineColor.BLACK_0);
        set.addLine(new Point(-50.0, 50.0), new Point(-50.0, -50.0), LineColor.BLACK_0);
        set.addLine(new Point(-50.0, -50.0), new Point(50.0, 50.0), LineColor.RED_1);
        return set;
    }

    private static void customLineType(String[] args) {
        if (args.length != 3) {
            usage("custom-line-type expects custom type number and line color number");
        }

        CustomLineTypes customLineType = CustomLineTypes.from(Integer.parseInt(args[1]));
        LineColor lineColor = LineColor.fromNumber(Integer.parseInt(args[2]));

        System.out.println(customLineType.getNumber()
                + ","
                + customLineType.getNumberForLineColor()
                + ","
                + customLineType.getLineColor().getNumber()
                + ","
                + customLineType.matches(lineColor));
    }

    private static void intersection(String[] args) {
        if (args.length != 11) {
            usage("intersection expects mode, precision, and eight coordinates");
        }

        boolean sweet = switch (args[1]) {
            case "strict" -> false;
            case "sweet" -> true;
            default -> throw new IllegalArgumentException("unknown intersection mode: " + args[1]);
        };

        String precisionArg = args[2];
        LineSegment s1 = new LineSegment(
                parse(args[3]),
                parse(args[4]),
                parse(args[5]),
                parse(args[6]));
        LineSegment s2 = new LineSegment(
                parse(args[7]),
                parse(args[8]),
                parse(args[9]),
                parse(args[10]));
        LineSegment.Intersection result;
        if (precisionArg.equals("default")) {
            result = sweet
                    ? OritaCalc.determineLineSegmentIntersectionSweet(s1, s2)
                    : OritaCalc.determineLineSegmentIntersection(s1, s2);
        } else {
            double precision = parse(precisionArg);
            result = sweet
                    ? OritaCalc.determineLineSegmentIntersectionSweet(s1, s2, precision, precision)
                    : OritaCalc.determineLineSegmentIntersection(s1, s2, precision);
        }

        System.out.println(result.getState());
    }

    private static void intersectDivide(String[] args) throws Exception {
        if (args.length < 2) {
            usage("intersect-divide expects a segment count and segment payload");
        }

        int count = Integer.parseInt(args[1]);
        LineSegmentSet set = lineSegmentSet(args, 2, count);
        IntersectDivide.apply(set);
        printLineSegmentSet(set);
    }

    private static void splitSubfaceArrangement(String[] args) throws Exception {
        if (args.length < 2) {
            usage("split-subface-arrangement expects a segment count and segment payload");
        }

        int count = Integer.parseInt(args[1]);
        LineSegmentSet set = lineSegmentSet(args, 2, count);
        LineSegmentSetWorker worker = new LineSegmentSetWorker();
        worker.set(set);
        printLineSegmentSet(worker.split_arrangement_for_SubFace_generation());
    }

    private static void twoColoredSubfaceArrangement(String[] args) throws Exception {
        if (args.length < 3) {
            usage("two-colored-subface-arrangement expects starting face, count, and segment payload");
        }

        int startingFace = Integer.parseInt(args[1]);
        int count = Integer.parseInt(args[2]);
        LineSegmentSet set = lineSegmentSet(args, 3, count);

        WireFrame_Worker flat = new WireFrame_Worker(3.0);
        flat.setLineSegmentSet(set);
        flat.setStartingFaceId(startingFace);
        PointSet facePositions = flat.getFacePositions();

        LineSegmentSetWorker worker = new LineSegmentSetWorker();
        worker.set(new LineSegmentSet(facePositions));
        printLineSegmentSet(worker.split_arrangement_for_SubFace_generation());
    }

    private static void twoColoredEstimateSummary(String[] args) throws Exception {
        if (args.length < 3) {
            usage("two-colored-estimate-summary expects starting face, count, and segment payload");
        }

        int startingFace = Integer.parseInt(args[1]);
        int count = Integer.parseInt(args[2]);
        LineSegmentSet set = lineSegmentSet(args, 3, count);

        FoldedFigure foldedFigure = new FoldedFigure(new NoopBulletinBoard());
        foldedFigure.createTwoColorCreasePattern(set, startingFace);
        printFoldingEstimateAndWorker(foldedFigure);
    }

    private static void subfaceConfigurationSummary(String[] args) throws Exception {
        if (args.length < 3) {
            usage("subface-configuration-summary expects starting face, count, and segment payload");
        }

        int startingFace = Integer.parseInt(args[1]);
        int count = Integer.parseInt(args[2]);
        LineSegmentSet set = lineSegmentSet(args, 3, count);

        WireFrame_Worker flat = new WireFrame_Worker(3.0);
        flat.setLineSegmentSet(set);
        flat.setStartingFaceId(startingFace);
        PointSet foldedNotSubdivided = flat.folding();

        LineSegmentSetWorker lineWorker = new LineSegmentSetWorker();
        lineWorker.set(new LineSegmentSet(foldedNotSubdivided));
        lineWorker.split_arrangement_for_SubFace_generation();

        WireFrame_Worker subdivided = new WireFrame_Worker(3.0);
        subdivided.setLineSegmentSet(lineWorker.get());

        NoopBulletinBoard bulletinBoard = new NoopBulletinBoard();
        FoldedFigure_Worker foldedWorker = new FoldedFigure_Worker(bulletinBoard);
        FoldedFigure_Configurator configurator =
                new FoldedFigure_Configurator(bulletinBoard, foldedWorker);
        configurator.configureSubFaces(foldedNotSubdivided, subdivided.get());
        printSubfaceConfiguration(foldedWorker);
    }

    private static void initialHierarchySummary(String[] args) throws Exception {
        if (args.length < 3) {
            usage("initial-hierarchy-summary expects starting face, count, and segment payload");
        }

        int startingFace = Integer.parseInt(args[1]);
        int count = Integer.parseInt(args[2]);
        LineSegmentSet set = lineSegmentSet(args, 3, count);

        WireFrame_Worker flat = new WireFrame_Worker(3.0);
        flat.setLineSegmentSet(set);
        flat.setStartingFaceId(startingFace);
        PointSet folded = flat.folding();

        List<int[]> relations = new ArrayList<>();
        for (int i = 1; i <= flat.getNumLines(); i++) {
            int faceIdMin = flat.lineInFaceBorder_min_request(i);
            int faceIdMax = flat.lineInFaceBorder_max_request(i);
            if (faceIdMin != faceIdMax) {
                int minPos = flat.getIFacePosition(faceIdMin);
                int maxPos = flat.getIFacePosition(faceIdMax);
                if (minPos % 2 == maxPos % 2) {
                    System.out.println("hierarchy_error|same_parity|"
                            + (i - 1) + "|"
                            + (faceIdMin - 1) + "|"
                            + (faceIdMax - 1));
                    return;
                }

                int value;
                if (folded.getColor(i) == LineColor.RED_1) {
                    value = minPos % 2 == 1 ? HierarchyList.ABOVE_1 : HierarchyList.BELOW_0;
                } else {
                    value = minPos % 2 == 1 ? HierarchyList.BELOW_0 : HierarchyList.ABOVE_1;
                }

                if (value == HierarchyList.ABOVE_1) {
                    relations.add(new int[] {faceIdMin - 1, faceIdMax - 1});
                } else {
                    relations.add(new int[] {faceIdMax - 1, faceIdMin - 1});
                }
            }
        }

        System.out.println("hierarchy|" + folded.getNumFaces() + "|" + relations.size());
        for (int[] relation : relations) {
            System.out.println("relation|" + relation[0] + "|" + relation[1]);
        }
    }

    private static void equivalenceCandidatesSummary(String[] args) throws Exception {
        if (args.length < 3) {
            usage("equivalence-candidates-summary expects starting face, count, and segment payload");
        }

        int startingFace = Integer.parseInt(args[1]);
        int count = Integer.parseInt(args[2]);
        LineSegmentSet set = lineSegmentSet(args, 3, count);

        WireFrame_Worker flat = new WireFrame_Worker(3.0);
        flat.setLineSegmentSet(set);
        flat.setStartingFaceId(startingFace);
        PointSet folded = flat.folding();
        HierarchyList hierarchyList = initialHierarchyList(flat, folded);
        if (hierarchyList == null) {
            return;
        }

        FoldedFigure_Worker foldedWorker = configuredSubfaceWorker(folded);
        SubFace[] reduced = reflectedReducedSubfaces(foldedWorker);

        List<int[]> triples = new ArrayList<>();
        for (int line = 1; line <= flat.getNumLines(); line++) {
            int min = flat.lineInFaceBorder_min_request(line);
            int max = flat.lineInFaceBorder_max_request(line);
            if (min != max) {
                for (int face = 1; face <= folded.getNumFaces(); face++) {
                    if (face != min && face != max && folded.convex_inside(line, face)) {
                        int[] pair = normalizedOraclePair(hierarchyList, min, max);
                        triples.add(new int[] {face - 1, pair[0] - 1, face - 1, pair[1] - 1});
                    }
                }
            }
        }

        List<int[]> quadruples = new ArrayList<>();
        for (int first = 1; first < flat.getNumLines(); first++) {
            int firstMin = flat.lineInFaceBorder_min_request(first);
            int firstMax = flat.lineInFaceBorder_max_request(first);
            if (firstMin == firstMax || firstMin == 0) {
                continue;
            }
            for (int second = first + 1; second <= flat.getNumLines(); second++) {
                int secondMin = flat.lineInFaceBorder_min_request(second);
                int secondMax = flat.lineInFaceBorder_max_request(second);
                if (secondMin != secondMax
                        && secondMin != 0
                        && folded.parallel_overlap(first, second)
                        && oracleSubfacesContainAll(reduced, firstMin, firstMax, secondMin, secondMax)) {
                    int[] firstPair = normalizedOraclePair(hierarchyList, firstMin, firstMax);
                    int[] secondPair = normalizedOraclePair(hierarchyList, secondMin, secondMax);
                    quadruples.add(new int[] {
                            firstPair[0] - 1,
                            firstPair[1] - 1,
                            secondPair[0] - 1,
                            secondPair[1] - 1});
                }
            }
        }

        System.out.println("equivalence|" + triples.size() + "|" + quadruples.size());
        for (int[] condition : triples) {
            System.out.println("triple|" + condition[0] + "|" + condition[1] + "|" + condition[2] + "|" + condition[3]);
        }
        for (int[] condition : quadruples) {
            System.out.println("quad|" + condition[0] + "|" + condition[1] + "|" + condition[2] + "|" + condition[3]);
        }
    }

    private static void additionalEstimationSummary(String[] args) throws Exception {
        if (args.length < 3) {
            usage("additional-estimation-summary expects starting face, count, and segment payload");
        }

        int startingFace = Integer.parseInt(args[1]);
        int count = Integer.parseInt(args[2]);
        LineSegmentSet set = lineSegmentSet(args, 3, count);

        WireFrame_Worker flat = new WireFrame_Worker(3.0);
        flat.setLineSegmentSet(set);
        flat.setStartingFaceId(startingFace);
        PointSet folded = flat.folding();

        LineSegmentSetWorker lineWorker = new LineSegmentSetWorker();
        lineWorker.set(new LineSegmentSet(folded));
        lineWorker.split_arrangement_for_SubFace_generation();

        WireFrame_Worker subdivided = new WireFrame_Worker(3.0);
        subdivided.setLineSegmentSet(lineWorker.get());

        NoopBulletinBoard bulletinBoard = new NoopBulletinBoard();
        FoldedFigure_Worker foldedWorker = new FoldedFigure_Worker(bulletinBoard);
        FoldedFigure_Configurator configurator =
                new FoldedFigure_Configurator(bulletinBoard, foldedWorker);
        configurator.configureSubFaces(folded, subdivided.get());
        FoldedFigure_Worker.HierarchyListStatus status = configurator.HierarchyList_configure(flat);
        if (status != FoldedFigure_Worker.HierarchyListStatus.SUCCESSFUL_1000) {
            System.out.println("additional_error|" + status.name());
            return;
        }

        printHierarchyRelations(foldedWorker.hierarchyList);
    }

    private static void foldingEstimateSummary(String[] args) throws Exception {
        if (args.length < 4) {
            usage("folding-estimate-summary expects starting face, order, count, and segment payload");
        }

        int startingFace = Integer.parseInt(args[1]);
        int order = Integer.parseInt(args[2]);
        int count = Integer.parseInt(args[3]);
        LineSegmentSet set = lineSegmentSet(args, 4, count);

        FoldedFigure foldedFigure = new FoldedFigure(new NoopBulletinBoard());
        foldedFigure.estimationOrder = FoldedFigure.EstimationOrder.valueOf("ORDER_" + order);
        foldedFigure.folding_estimated(set, startingFace);

        System.out.println("folding_estimate|"
                + foldedFigure.estimationStep.name() + "|"
                + foldedFigure.displayStyle.name() + "|"
                + foldedFigure.discovered_fold_cases + "|"
                + foldedFigure.findAnotherOverlapValid + "|"
                + foldedFigure.text_result);
        printWorkerOverlapSearch(
                foldedFigure.ip2_possibleOverlap,
                foldedFigure.foldedFigure_worker.getSubFace_valid_number(),
                foldedFigure.foldedFigure_worker.SubFaceTotal,
                foldedFigure.foldedFigure_worker.hierarchyList);
    }

    private static void foldingEstimateSequenceSummary(String[] args) throws Exception {
        if (args.length < 5) {
            usage("folding-estimate-sequence-summary expects starting face, order count, orders, count, and segment payload");
        }

        int startingFace = Integer.parseInt(args[1]);
        int orderCount = Integer.parseInt(args[2]);
        int offset = 3;
        int[] orders = new int[orderCount];
        for (int i = 0; i < orderCount; i++) {
            orders[i] = Integer.parseInt(args[offset++]);
        }
        int count = Integer.parseInt(args[offset++]);
        LineSegmentSet set = lineSegmentSet(args, offset, count);

        FoldedFigure foldedFigure = new FoldedFigure(new NoopBulletinBoard());
        for (int i = 0; i < orderCount; i++) {
            foldedFigure.estimationOrder = FoldedFigure.EstimationOrder.valueOf("ORDER_" + orders[i]);
            foldedFigure.folding_estimated(set, startingFace);

            System.out.println("folding_estimate_action|" + orders[i]);
            System.out.println("folding_estimate|"
                    + foldedFigure.estimationStep.name() + "|"
                    + foldedFigure.displayStyle.name() + "|"
                    + foldedFigure.discovered_fold_cases + "|"
                    + foldedFigure.findAnotherOverlapValid + "|"
                    + foldedFigure.text_result);
            printWorkerOverlapSearch(
                    foldedFigure.ip2_possibleOverlap,
                    foldedFigure.foldedFigure_worker.getSubFace_valid_number(),
                    foldedFigure.foldedFigure_worker.SubFaceTotal,
                    foldedFigure.foldedFigure_worker.hierarchyList);
        }
    }

    private static void foldingEstimateSpecificSummary(String[] args) throws Exception {
        if (args.length < 5) {
            usage("folding-estimate-specific-summary expects starting face, objective, initial order, count, and segment payload");
        }

        int startingFace = Integer.parseInt(args[1]);
        int objective = Integer.parseInt(args[2]);
        int initialOrder = Integer.parseInt(args[3]);
        int count = Integer.parseInt(args[4]);
        LineSegmentSet set = lineSegmentSet(args, 5, count);

        FoldedFigure foldedFigure = new FoldedFigure(new NoopBulletinBoard());
        foldedFigure.estimationOrder = FoldedFigure.EstimationOrder.valueOf("ORDER_" + initialOrder);
        if (objective == foldedFigure.discovered_fold_cases) {
            foldedFigure.text_result = "Number of found solutions = " + foldedFigure.discovered_fold_cases + "  ";
        }
        while (objective > foldedFigure.discovered_fold_cases) {
            foldedFigure.folding_estimated(set, startingFace);
            System.out.println("specific_case|" + foldedFigure.discovered_fold_cases);
            foldedFigure.estimationOrder = FoldedFigure.EstimationOrder.ORDER_6;
            if (!foldedFigure.findAnotherOverlapValid) {
                objective = foldedFigure.discovered_fold_cases;
            }
        }
        printFoldingEstimateAndWorker(foldedFigure);
    }

    private static void foldingEstimateSaveBatchSummary(String[] args) throws Exception {
        if (args.length < 4) {
            usage("folding-estimate-save-batch-summary expects starting face, objective, count, and segment payload");
        }

        int startingFace = Integer.parseInt(args[1]);
        int objective = Integer.parseInt(args[2]);
        int count = Integer.parseInt(args[3]);
        LineSegmentSet set = lineSegmentSet(args, 4, count);

        FoldedFigure foldedFigure = new FoldedFigure(new NoopBulletinBoard());
        foldedFigure.estimationOrder = FoldedFigure.EstimationOrder.ORDER_6;
        for (int i = 1; i <= objective; i++) {
            foldedFigure.folding_estimated(set, startingFace);
            System.out.println("batch_case|" + foldedFigure.discovered_fold_cases);
            if (!foldedFigure.findAnotherOverlapValid) {
                objective = foldedFigure.discovered_fold_cases;
            }
        }
        printFoldingEstimateAndWorker(foldedFigure);
    }

    private static void foldingEstimateCaseFilename(String[] args) {
        if (args.length != 3) {
            usage("folding-estimate-case-filename expects filename and discovered case");
        }

        String filename = args[1];
        int discovered = Integer.parseInt(args[2]);
        if (filename.contains(".")) {
            String extension = filename.substring(filename.lastIndexOf("."));
            String basename = filename.substring(0, filename.lastIndexOf("."));

            filename = basename + "_" + discovered + extension;
        }
        System.out.println("case_filename|" + filename);
    }

    private static void duplicateEstimationOrder(String[] args) {
        if (args.length != 2) {
            usage("duplicate-estimation-order expects a FoldedFigure.DisplayStyle name");
        }

        FoldedFigure.DisplayStyle style = FoldedFigure.DisplayStyle.valueOf(args[1]);
        FoldedFigure.EstimationOrder order = switch (style) {
            case NONE_0 -> FoldedFigure.EstimationOrder.ORDER_0;
            case DEVELOPMENT_1 -> FoldedFigure.EstimationOrder.ORDER_1;
            case WIRE_2 -> FoldedFigure.EstimationOrder.ORDER_2;
            case TRANSPARENT_3 -> FoldedFigure.EstimationOrder.ORDER_3;
            case DEVELOPMENT_4 -> FoldedFigure.EstimationOrder.ORDER_4;
            case PAPER_5 -> FoldedFigure.EstimationOrder.ORDER_5;
            default -> FoldedFigure.EstimationOrder.ORDER_5;
        };
        System.out.println("duplicate_order|" + order.name());
    }

    private static void chainPermutationSummary(String[] args) throws Exception {
        if (args.length < 6) {
            usage("chain-permutation-summary expects digit count, guide count, guide pairs, top indices, bottom indices, and limit");
        }

        int numDigits = Integer.parseInt(args[1]);
        int guideCount = Integer.parseInt(args[2]);
        int offset = 3;
        ChainPermutationGenerator generator = new ChainPermutationGenerator(numDigits);
        for (int i = 0; i < guideCount; i++) {
            generator.addGuide(Integer.parseInt(args[offset]), Integer.parseInt(args[offset + 1]));
            offset += 2;
        }
        generator.setTopIndices(parseIndexList(args[offset++]));
        generator.setBottomIndices(parseIndexList(args[offset++]));
        int limit = Integer.parseInt(args[offset]);

        generator.initialize();
        printChainPermutationSequence(generator, numDigits, limit);
    }

    private static void chainPermutationTempSummary(String[] args) throws Exception {
        if (args.length < 11) {
            usage("chain-permutation-temp-summary expects digit count, guide count, guide pairs, top indices, bottom indices, steps before temp, temp guide pair, steps after temp, and limit after clear");
        }

        int numDigits = Integer.parseInt(args[1]);
        int guideCount = Integer.parseInt(args[2]);
        int offset = 3;
        ChainPermutationGenerator generator = new ChainPermutationGenerator(numDigits);
        for (int i = 0; i < guideCount; i++) {
            generator.addGuide(Integer.parseInt(args[offset]), Integer.parseInt(args[offset + 1]));
            offset += 2;
        }
        generator.setTopIndices(parseIndexList(args[offset++]));
        generator.setBottomIndices(parseIndexList(args[offset++]));
        int stepsBeforeTemp = Integer.parseInt(args[offset++]);
        int tempUpper = Integer.parseInt(args[offset++]);
        int tempLower = Integer.parseInt(args[offset++]);
        int stepsAfterTemp = Integer.parseInt(args[offset++]);
        int limitAfterClear = Integer.parseInt(args[offset]);

        generator.initialize();
        System.out.println("permutations|" + generator.getCount());
        printChainPermutation(0, 0, generator, numDigits);
        for (int i = 1; i <= stepsBeforeTemp; i++) {
            int changed = generator.next(numDigits);
            if (changed == 0) {
                System.out.println("end|" + i + "|0|" + generator.getCount());
                return;
            }
            printChainPermutation(i, changed, generator, numDigits);
        }

        generator.addGuide(tempUpper, tempLower);
        System.out.println("temp|" + tempUpper + "|" + tempLower);
        for (int i = 1; i <= stepsAfterTemp; i++) {
            int changed = generator.next(numDigits);
            if (changed == 0) {
                System.out.println("end_temp|" + i + "|0|" + generator.getCount());
                return;
            }
            printChainPermutation(i, changed, generator, numDigits);
        }

        generator.clearTempGuide();
        System.out.println("clear_temp");
        for (int i = 1; i <= limitAfterClear; i++) {
            int changed = generator.next(numDigits);
            if (changed == 0) {
                System.out.println("end_clear|" + i + "|0|" + generator.getCount());
                return;
            }
            printChainPermutation(i, changed, generator, numDigits);
        }
    }

    private static void subfaceGuidePermutationSummary(String[] args) throws Exception {
        if (args.length < 6) {
            usage("subface-guide-permutation-summary expects faces total, face count, face ids, relation count, relation pairs, and limit");
        }

        int facesTotal = Integer.parseInt(args[1]);
        int faceCount = Integer.parseInt(args[2]);
        int offset = 3;
        SubFace subFace = new SubFace(new NoopBulletinBoard());
        subFace.setNumDigits(faceCount);
        for (int i = 1; i <= faceCount; i++) {
            subFace.setFaceId(i, Integer.parseInt(args[offset++]) + 1);
        }

        HierarchyList hierarchyList = new HierarchyList();
        hierarchyList.setFacesTotal(facesTotal);
        int relationCount = Integer.parseInt(args[offset++]);
        for (int i = 0; i < relationCount; i++) {
            int upper = Integer.parseInt(args[offset++]) + 1;
            int lower = Integer.parseInt(args[offset++]) + 1;
            hierarchyList.set(upper, lower, HierarchyList.ABOVE_1);
        }
        int limit = Integer.parseInt(args[offset]);

        subFace.setGuideMap(hierarchyList);
        printSubfacePermutationSequence(subFace, faceCount, limit);
    }

    private static void subfaceOverlapSearchSummary(String[] args) throws Exception {
        if (args.length < 7) {
            usage("subface-overlap-search-summary expects faces total, face count, face ids, relation count, relation pairs, 3EC count, 3EC entries, 4EC count, and 4EC entries");
        }

        int facesTotal = Integer.parseInt(args[1]);
        int faceCount = Integer.parseInt(args[2]);
        int offset = 3;
        SubFace subFace = new SubFace(new NoopBulletinBoard());
        subFace.setNumDigits(faceCount);
        for (int i = 1; i <= faceCount; i++) {
            subFace.setFaceId(i, Integer.parseInt(args[offset++]) + 1);
        }

        HierarchyList hierarchyList = new HierarchyList();
        hierarchyList.setFacesTotal(facesTotal);
        int relationCount = Integer.parseInt(args[offset++]);
        for (int i = 0; i < relationCount; i++) {
            int upper = Integer.parseInt(args[offset++]) + 1;
            int lower = Integer.parseInt(args[offset++]) + 1;
            hierarchyList.set(upper, lower, HierarchyList.ABOVE_1);
        }

        int tripleCount = Integer.parseInt(args[offset++]);
        for (int i = 0; i < tripleCount; i++) {
            hierarchyList.addEquivalenceCondition(new origami.folding.util.EquivalenceCondition(
                    Integer.parseInt(args[offset++]) + 1,
                    Integer.parseInt(args[offset++]) + 1,
                    Integer.parseInt(args[offset++]) + 1,
                    Integer.parseInt(args[offset++]) + 1));
        }

        int quadrupleCount = Integer.parseInt(args[offset++]);
        for (int i = 0; i < quadrupleCount; i++) {
            hierarchyList.addUEquivalenceCondition(new origami.folding.util.EquivalenceCondition(
                    Integer.parseInt(args[offset++]) + 1,
                    Integer.parseInt(args[offset++]) + 1,
                    Integer.parseInt(args[offset++]) + 1,
                    Integer.parseInt(args[offset++]) + 1));
        }

        subFace.setGuideMap(hierarchyList);
        int result = subFace.possible_overlapping_search(hierarchyList);
        printSubfaceOverlapSearch(result, subFace, faceCount);
    }

    private static void subfacePrioritySummary(String[] args) {
        if (args.length < 5) {
            usage("subface-priority-summary expects faces total, subface count, subfaces, relation count, and relation pairs");
        }

        int facesTotal = Integer.parseInt(args[1]);
        int subfaceCount = Integer.parseInt(args[2]);
        int offset = 3;
        SubFace[] subfaces = new SubFace[subfaceCount + 1];
        subfaces[0] = new SubFace(new NoopBulletinBoard());
        for (int i = 1; i <= subfaceCount; i++) {
            int faceCount = Integer.parseInt(args[offset++]);
            subfaces[i] = new SubFace(new NoopBulletinBoard());
            subfaces[i].setNumDigits(faceCount);
            for (int j = 1; j <= faceCount; j++) {
                subfaces[i].setFaceId(j, Integer.parseInt(args[offset++]) + 1);
            }
        }

        HierarchyList hierarchyList = new HierarchyList();
        hierarchyList.setFacesTotal(facesTotal);
        int relationCount = Integer.parseInt(args[offset++]);
        for (int i = 0; i < relationCount; i++) {
            int upper = Integer.parseInt(args[offset++]) + 1;
            int lower = Integer.parseInt(args[offset++]) + 1;
            hierarchyList.set(upper, lower, HierarchyList.ABOVE_1);
        }

        SubFacePriority priority = new SubFacePriority(facesTotal, subfaceCount);
        for (int i = 1; i <= subfaceCount; i++) {
            priority.addSubFace(subfaces[i], i, hierarchyList);
        }

        int validCount = 0;
        int[] ordered = new int[subfaceCount + 1];
        for (int i = 1; i <= subfaceCount; i++) {
            long result = priority.getMaxSubFace(subfaces);
            int selected = (int) (result & SubFacePriority.mask);
            int max = (int) (result >>> 32);
            ordered[i] = selected;
            if (max > 0) {
                validCount++;
            }
            priority.processSubFace(subfaces[selected], selected, hierarchyList);
        }

        System.out.println("subface_priority|" + validCount + "|" + subfaceCount);
        for (int i = 1; i <= subfaceCount; i++) {
            System.out.println("priority_subface|"
                    + (i - 1) + "|"
                    + (ordered[i] - 1) + "|"
                    + oracleSubfaceFaceIds(subfaces[ordered[i]]));
        }
    }

    private static void workerOverlapSearchSummary(String[] args, boolean swap) throws Exception {
        if (args.length < 7) {
            usage("worker-overlap-search-summary expects faces total, subface count, subfaces, relation count, relation pairs, 3EC count, 3EC entries, 4EC count, and 4EC entries");
        }

        int facesTotal = Integer.parseInt(args[1]);
        int subfaceCount = Integer.parseInt(args[2]);
        int offset = 3;
        SubFace[] subfaces = new SubFace[subfaceCount + 1];
        java.util.IdentityHashMap<SubFace, Integer> subfaceIds = new java.util.IdentityHashMap<>();
        subfaces[0] = new SubFace(new NoopBulletinBoard());
        for (int i = 1; i <= subfaceCount; i++) {
            int faceCount = Integer.parseInt(args[offset++]);
            subfaces[i] = new SubFace(new NoopBulletinBoard());
            subfaceIds.put(subfaces[i], i - 1);
            subfaces[i].setNumDigits(faceCount);
            for (int j = 1; j <= faceCount; j++) {
                subfaces[i].setFaceId(j, Integer.parseInt(args[offset++]) + 1);
            }
        }

        NoopBulletinBoard bulletinBoard = new NoopBulletinBoard();
        FoldedFigure_Worker worker = new FoldedFigure_Worker(bulletinBoard);
        worker.hierarchyList.setFacesTotal(facesTotal);
        int relationCount = Integer.parseInt(args[offset++]);
        for (int i = 0; i < relationCount; i++) {
            int upper = Integer.parseInt(args[offset++]) + 1;
            int lower = Integer.parseInt(args[offset++]) + 1;
            worker.hierarchyList.set(upper, lower, HierarchyList.ABOVE_1);
        }

        int tripleCount = Integer.parseInt(args[offset++]);
        for (int i = 0; i < tripleCount; i++) {
            worker.hierarchyList.addEquivalenceCondition(new origami.folding.util.EquivalenceCondition(
                    Integer.parseInt(args[offset++]) + 1,
                    Integer.parseInt(args[offset++]) + 1,
                    Integer.parseInt(args[offset++]) + 1,
                    Integer.parseInt(args[offset++]) + 1));
        }

        int quadrupleCount = Integer.parseInt(args[offset++]);
        for (int i = 0; i < quadrupleCount; i++) {
            worker.hierarchyList.addUEquivalenceCondition(new origami.folding.util.EquivalenceCondition(
                    Integer.parseInt(args[offset++]) + 1,
                    Integer.parseInt(args[offset++]) + 1,
                    Integer.parseInt(args[offset++]) + 1,
                    Integer.parseInt(args[offset++]) + 1));
        }

        worker.hierarchyList.save();
        worker.SubFaceTotal = subfaceCount;
        worker.s0 = subfaces;
        worker.s = new SubFace[subfaceCount + 1];
        worker.s[0] = subfaces[0];

        SubFacePriority priority = new SubFacePriority(facesTotal, subfaceCount);
        for (int i = 1; i <= subfaceCount; i++) {
            priority.addSubFace(subfaces[i], i, worker.hierarchyList);
        }

        int validCount = 0;
        SubFace[] reduced = new SubFace[subfaceCount + 1];
        reduced[0] = subfaces[0];
        for (int i = 1; i <= subfaceCount; i++) {
            long result = priority.getMaxSubFace(subfaces);
            int selected = (int) (result & SubFacePriority.mask);
            int max = (int) (result >>> 32);
            worker.s[i] = subfaces[selected];
            reduced[i] = subfaces[selected];
            if (max > 0) {
                validCount++;
            }
            priority.processSubFace(subfaces[selected], selected, worker.hierarchyList);
        }

        Field s1Field = FoldedFigure_Worker.class.getDeclaredField("s1");
        s1Field.setAccessible(true);
        s1Field.set(worker, reduced);
        Field validField = FoldedFigure_Worker.class.getDeclaredField("SubFace_valid_number");
        validField.setAccessible(true);
        validField.setInt(worker, validCount);

        for (int i = 1; i <= validCount; i++) {
            worker.s[i].setGuideMap(worker.hierarchyList);
        }

        int result = worker.possible_overlapping_search(swap);
        printWorkerOverlapSearch(result, validCount, subfaceCount, worker.hierarchyList);
        if (swap) {
            printWorkerSubfaceOrder(worker.s, subfaceCount, subfaceIds);
        }
    }

    private static void workerOverlapOrderedSummary(String[] args) throws Exception {
        if (args.length < 8) {
            usage("worker-overlap-ordered-summary expects faces total, subface count, valid count, swap flag, subfaces, relation count, relation pairs, 3EC count, 3EC entries, 4EC count, and 4EC entries");
        }

        int facesTotal = Integer.parseInt(args[1]);
        int subfaceCount = Integer.parseInt(args[2]);
        int validCount = Integer.parseInt(args[3]);
        boolean swap = Boolean.parseBoolean(args[4]);
        int offset = 5;
        SubFace[] subfaces = new SubFace[subfaceCount + 1];
        java.util.IdentityHashMap<SubFace, Integer> subfaceIds = new java.util.IdentityHashMap<>();
        subfaces[0] = new SubFace(new NoopBulletinBoard());
        for (int i = 1; i <= subfaceCount; i++) {
            int faceCount = Integer.parseInt(args[offset++]);
            subfaces[i] = new SubFace(new NoopBulletinBoard());
            subfaceIds.put(subfaces[i], i - 1);
            subfaces[i].setNumDigits(faceCount);
            for (int j = 1; j <= faceCount; j++) {
                subfaces[i].setFaceId(j, Integer.parseInt(args[offset++]) + 1);
            }
        }

        NoopBulletinBoard bulletinBoard = new NoopBulletinBoard();
        FoldedFigure_Worker worker = new FoldedFigure_Worker(bulletinBoard);
        worker.hierarchyList.setFacesTotal(facesTotal);
        int relationCount = Integer.parseInt(args[offset++]);
        for (int i = 0; i < relationCount; i++) {
            int upper = Integer.parseInt(args[offset++]) + 1;
            int lower = Integer.parseInt(args[offset++]) + 1;
            worker.hierarchyList.set(upper, lower, HierarchyList.ABOVE_1);
        }

        int tripleCount = Integer.parseInt(args[offset++]);
        for (int i = 0; i < tripleCount; i++) {
            worker.hierarchyList.addEquivalenceCondition(new origami.folding.util.EquivalenceCondition(
                    Integer.parseInt(args[offset++]) + 1,
                    Integer.parseInt(args[offset++]) + 1,
                    Integer.parseInt(args[offset++]) + 1,
                    Integer.parseInt(args[offset++]) + 1));
        }

        int quadrupleCount = Integer.parseInt(args[offset++]);
        for (int i = 0; i < quadrupleCount; i++) {
            worker.hierarchyList.addUEquivalenceCondition(new origami.folding.util.EquivalenceCondition(
                    Integer.parseInt(args[offset++]) + 1,
                    Integer.parseInt(args[offset++]) + 1,
                    Integer.parseInt(args[offset++]) + 1,
                    Integer.parseInt(args[offset++]) + 1));
        }

        worker.hierarchyList.save();
        worker.SubFaceTotal = subfaceCount;
        worker.s0 = subfaces;
        worker.s = subfaces.clone();

        Field s1Field = FoldedFigure_Worker.class.getDeclaredField("s1");
        s1Field.setAccessible(true);
        s1Field.set(worker, subfaces.clone());
        Field validField = FoldedFigure_Worker.class.getDeclaredField("SubFace_valid_number");
        validField.setAccessible(true);
        validField.setInt(worker, validCount);

        for (int i = 1; i <= validCount; i++) {
            worker.s[i].setGuideMap(worker.hierarchyList);
        }

        int result = worker.possible_overlapping_search(swap);
        printWorkerOverlapSearch(
                result,
                worker.getSubFace_valid_number(),
                subfaceCount,
                worker.hierarchyList);
        printWorkerSubfaceOrder(worker.s, subfaceCount, subfaceIds);
    }

    private static void workerOverlapOrderedSequenceSummary(String[] args) throws Exception {
        if (args.length < 8) {
            usage("worker-overlap-ordered-sequence-summary expects faces total, subface count, valid count, subfaces, relation count, relation pairs, 3EC count, 3EC entries, 4EC count, 4EC entries, action count, and actions");
        }

        int facesTotal = Integer.parseInt(args[1]);
        int subfaceCount = Integer.parseInt(args[2]);
        int validCount = Integer.parseInt(args[3]);
        int offset = 4;
        SubFace[] subfaces = new SubFace[subfaceCount + 1];
        java.util.IdentityHashMap<SubFace, Integer> subfaceIds = new java.util.IdentityHashMap<>();
        subfaces[0] = new SubFace(new NoopBulletinBoard());
        for (int i = 1; i <= subfaceCount; i++) {
            int faceCount = Integer.parseInt(args[offset++]);
            subfaces[i] = new SubFace(new NoopBulletinBoard());
            subfaceIds.put(subfaces[i], i - 1);
            subfaces[i].setNumDigits(faceCount);
            for (int j = 1; j <= faceCount; j++) {
                subfaces[i].setFaceId(j, Integer.parseInt(args[offset++]) + 1);
            }
        }

        NoopBulletinBoard bulletinBoard = new NoopBulletinBoard();
        FoldedFigure_Worker worker = new FoldedFigure_Worker(bulletinBoard);
        worker.hierarchyList.setFacesTotal(facesTotal);
        int relationCount = Integer.parseInt(args[offset++]);
        for (int i = 0; i < relationCount; i++) {
            int upper = Integer.parseInt(args[offset++]) + 1;
            int lower = Integer.parseInt(args[offset++]) + 1;
            worker.hierarchyList.set(upper, lower, HierarchyList.ABOVE_1);
        }

        int tripleCount = Integer.parseInt(args[offset++]);
        for (int i = 0; i < tripleCount; i++) {
            worker.hierarchyList.addEquivalenceCondition(new origami.folding.util.EquivalenceCondition(
                    Integer.parseInt(args[offset++]) + 1,
                    Integer.parseInt(args[offset++]) + 1,
                    Integer.parseInt(args[offset++]) + 1,
                    Integer.parseInt(args[offset++]) + 1));
        }

        int quadrupleCount = Integer.parseInt(args[offset++]);
        for (int i = 0; i < quadrupleCount; i++) {
            worker.hierarchyList.addUEquivalenceCondition(new origami.folding.util.EquivalenceCondition(
                    Integer.parseInt(args[offset++]) + 1,
                    Integer.parseInt(args[offset++]) + 1,
                    Integer.parseInt(args[offset++]) + 1,
                    Integer.parseInt(args[offset++]) + 1));
        }

        worker.hierarchyList.save();
        worker.SubFaceTotal = subfaceCount;
        worker.s0 = subfaces;
        worker.s = subfaces.clone();

        Field s1Field = FoldedFigure_Worker.class.getDeclaredField("s1");
        s1Field.setAccessible(true);
        s1Field.set(worker, subfaces.clone());
        Field validField = FoldedFigure_Worker.class.getDeclaredField("SubFace_valid_number");
        validField.setAccessible(true);
        validField.setInt(worker, validCount);

        for (int i = 1; i <= validCount; i++) {
            worker.s[i].setGuideMap(worker.hierarchyList);
        }

        int actionCount = Integer.parseInt(args[offset++]);
        for (int i = 0; i < actionCount; i++) {
            String action = args[offset++];
            if ("search".equals(action)) {
                boolean swap = Boolean.parseBoolean(args[offset++]);
                int result = worker.possible_overlapping_search(swap);
                System.out.println("worker_action|search|" + swap);
                printWorkerOverlapSearch(
                        result,
                        worker.getSubFace_valid_number(),
                        subfaceCount,
                        worker.hierarchyList);
                printWorkerSubfaceOrder(worker.s, subfaceCount, subfaceIds);
            } else if ("next".equals(action)) {
                int ss = Integer.parseInt(args[offset++]);
                int changed = worker.next(ss);
                System.out.println("worker_next|" + ss + "|" + changed + "|" + worker.getSubFace_valid_number());
                printWorkerSubfaceOrder(worker.s, subfaceCount, subfaceIds);
            } else {
                usage("unknown worker overlap sequence action: " + action);
            }
        }
    }

    private static void workerOverlapFromSegmentsSummary(String[] args, boolean swap) throws Exception {
        if (args.length < 3) {
            usage("worker-overlap-from-segments-summary expects starting face, count, and segment payload");
        }

        int startingFace = Integer.parseInt(args[1]);
        int count = Integer.parseInt(args[2]);
        LineSegmentSet set = lineSegmentSet(args, 3, count);

        WireFrame_Worker flat = new WireFrame_Worker(3.0);
        flat.setLineSegmentSet(set);
        flat.setStartingFaceId(startingFace);
        PointSet folded = flat.folding();

        LineSegmentSetWorker lineWorker = new LineSegmentSetWorker();
        lineWorker.set(new LineSegmentSet(folded));
        lineWorker.split_arrangement_for_SubFace_generation();

        WireFrame_Worker subdivided = new WireFrame_Worker(3.0);
        subdivided.setLineSegmentSet(lineWorker.get());

        NoopBulletinBoard bulletinBoard = new NoopBulletinBoard();
        FoldedFigure_Worker foldedWorker = new FoldedFigure_Worker(bulletinBoard);
        FoldedFigure_Configurator configurator =
                new FoldedFigure_Configurator(bulletinBoard, foldedWorker);
        configurator.configureSubFaces(folded, subdivided.get());
        FoldedFigure_Worker.HierarchyListStatus status = configurator.HierarchyList_configure(flat);
        if (status != FoldedFigure_Worker.HierarchyListStatus.SUCCESSFUL_1000) {
            System.out.println("worker_overlap_error|" + status.name());
            return;
        }

        int result = foldedWorker.possible_overlapping_search(swap);
        SubFace[] reduced = reflectedReducedSubfaces(foldedWorker);
        printWorkerOverlapSearch(
                result,
                foldedWorker.getSubFace_valid_number(),
                Math.max(0, reduced.length - 1),
                foldedWorker.hierarchyList);
    }

    private static void subfaceSwapperSummary(String[] args) {
        if (args.length < 4) {
            usage("subface-swapper-summary expects subface count, swap counters, and actions");
        }

        int count = Integer.parseInt(args[1]);
        int offset = 2;
        SubFace[] subfaces = new SubFace[count + 1];
        subfaces[0] = new SubFace(new NoopBulletinBoard());
        for (int i = 1; i <= count; i++) {
            subfaces[i] = new SubFace(new NoopBulletinBoard());
            subfaces[i].setNumDigits(1);
            subfaces[i].setFaceId(1, i);
            subfaces[i].swapCounter = Integer.parseInt(args[offset++]);
        }

        SubFaceSwappingAlgorithm swapper = new SubFaceSwappingAlgorithm();
        int actionCount = Integer.parseInt(args[offset++]);
        printSubfaceSwapper("initial", subfaces, count, swapper);
        for (int i = 0; i < actionCount; i++) {
            String action = args[offset++];
            switch (action) {
                case "visit" -> {
                    int index = Integer.parseInt(args[offset++]) + 1;
                    swapper.visit(subfaces[index]);
                    printSubfaceSwapper("visit|" + (index - 1), subfaces, count, swapper);
                }
                case "record" -> {
                    int index = Integer.parseInt(args[offset++]) + 1;
                    swapper.record(index);
                    printSubfaceSwapper("record|" + (index - 1), subfaces, count, swapper);
                }
                case "process" -> {
                    int max = Integer.parseInt(args[offset++]);
                    swapper.process(subfaces, max);
                    printSubfaceSwapper("process|" + max, subfaces, count, swapper);
                }
                case "estimate" -> {
                    int index = Integer.parseInt(args[offset++]) + 1;
                    System.out.println("estimate|" + (index - 1) + "|" + swapper.shouldEstimate(index));
                    printSubfaceSwapper("after_estimate|" + (index - 1), subfaces, count, swapper);
                }
                default -> usage("unknown subface-swapper action: " + action);
            }
        }
    }

    private static void intersectDividePair(String[] args) throws Exception {
        if (args.length < 4) {
            usage("intersect-divide-pair expects i, j, a segment count, and segment payload");
        }

        int i = Integer.parseInt(args[1]);
        int j = Integer.parseInt(args[2]);
        int count = Integer.parseInt(args[3]);
        LineSegmentSet set = lineSegmentSet(args, 4, count);
        Method method = IntersectDivide.class.getDeclaredMethod(
                "intersect_divide",
                LineSegmentSet.class,
                int.class,
                int.class);
        method.setAccessible(true);

        int added = (Integer) method.invoke(null, set, i, j);
        System.out.println("added|" + added);
        printLineSegmentSet(set);
    }

    private static void foldLineDivideNewLines(String[] args) {
        if (args.length < 4) {
            usage("foldline-divide-new-lines expects originalEnd, addedEnd, count, and segment payload");
        }

        int originalEnd = Integer.parseInt(args[1]);
        int addedEnd = Integer.parseInt(args[2]);
        int count = Integer.parseInt(args[3]);
        FoldLineSet set = foldLineSet(args, 4, count);
        set.divideLineSegmentWithNewLines(originalEnd, addedEnd);
        printFoldLineSet(set);
    }

    private static void foldLineDivideFast(String[] args) {
        if (args.length < 4) {
            usage("foldline-divide-fast expects i, j, count, and segment payload");
        }

        int i = Integer.parseInt(args[1]);
        int j = Integer.parseInt(args[2]);
        int count = Integer.parseInt(args[3]);
        FoldLineSet set = foldLineSet(args, 4, count);
        Set<Integer> toDelete = new HashSet<>();
        LineSegment.Intersection intersection = set.divideIntersectionsFast(i + 1, j + 1, toDelete);
        System.out.println("intersection|" + intersection.getState());
        printFoldLineSetDeleteSet(toDelete);
        printFoldLineSet(set);
    }

    private static void foldLineDeleteInside(String[] args) {
        if (args.length < 7) {
            usage("foldline-delete-inside expects mode, selection segment, count, and segment payload");
        }

        String mode = args[1];
        LineSegment selection = new LineSegment(
                new Point(parse(args[2]), parse(args[3])),
                new Point(parse(args[4]), parse(args[5])),
                LineColor.fromNumber(Integer.parseInt(args[6])));
        int count = Integer.parseInt(args[7]);
        FoldLineSet set = foldLineSet(args, 8, count);
        boolean deleted = set.deleteInsideLine(selection, mode);
        System.out.println("deleted|" + deleted);
        printFoldLineSet(set);
    }

    private static void foldLineDeleteLineVertex(String[] args) {
        if (args.length < 3) {
            usage("foldline-delete-line-vertex expects index, count, and segment payload");
        }

        int index = Integer.parseInt(args[1]);
        int count = Integer.parseInt(args[2]);
        FoldLineSet set = foldLineSet(args, 3, count);
        boolean deleted = false;
        if (index >= 0 && index < set.getTotal()) {
            set.deleteLineSegment_vertex(set.get(index + 1));
            deleted = true;
        }
        System.out.println("deleted|" + deleted);
        printFoldLineSet(set);
    }

    private static void foldLineDeleteLines(String[] args) {
        if (args.length < 4) {
            usage("foldline-delete-lines expects comma-separated indices, count, and segment payload");
        }

        int count = Integer.parseInt(args[2]);
        FoldLineSet set = foldLineSet(args, 3, count);
        List<LineSegment> lines = selectedFoldLines(set, args[1]);
        int deleted = 0;
        for (LineSegment line : lines) {
            set.deleteLine(line);
            deleted++;
        }
        System.out.println("deleted|" + deleted);
        printFoldLineSet(set);
    }

    private static void foldLineBranchTrim(String[] args) {
        if (args.length < 2) {
            usage("foldline-branch-trim expects a segment count and segment payload");
        }

        int count = Integer.parseInt(args[1]);
        FoldLineSet set = foldLineSet(args, 2, count);
        BranchTrim.apply(set);
        printFoldLineSet(set);
    }

    private static void foldLineCheck1(String[] args) {
        if (args.length < 2) {
            usage("foldline-check1 expects count and segment payload");
        }

        int count = Integer.parseInt(args[1]);
        FoldLineSet set = foldLineSet(args, 2, count);
        Check1.apply(set);
        printLineSegmentsList(set.getCheck1LineSegment());
    }

    private static void foldLineCheck2(String[] args) {
        if (args.length < 2) {
            usage("foldline-check2 expects count and segment payload");
        }

        int count = Integer.parseInt(args[1]);
        FoldLineSet set = foldLineSet(args, 2, count);
        Check2.apply(set);
        printLineSegmentsList(set.getCheck2LineSegment());
    }

    private static void foldLineCheck3(String[] args) {
        if (args.length < 2) {
            usage("foldline-check3 expects count and segment payload");
        }

        int count = Integer.parseInt(args[1]);
        FoldLineSet set = foldLineSet(args, 2, count);
        Check3.apply(set);
        printLineSegmentsList(set.getCheck3LineSegment());
    }

    private static void foldLineCheck4(String[] args) throws InterruptedException {
        if (args.length < 2) {
            usage("foldline-check4 expects count and segment payload");
        }

        int count = Integer.parseInt(args[1]);
        FoldLineSet set = foldLineSet(args, 2, count);
        PointLineMap map = new PointLineMap(set.getLineSegments());
        List<FlatFoldabilityViolation> violations = new ArrayList<>();
        for (Point point : map.getPoints()) {
            Check4.findFlatfoldabilityViolation(point, map.getLines(point)).ifPresent(violations::add);
        }
        printFlatFoldabilityViolations(violations);
    }

    private static void checkCamvTask(String[] args) throws InterruptedException {
        if (args.length < 2) {
            usage("check-camv-task expects count and segment payload");
        }

        int count = Integer.parseInt(args[1]);
        FoldLineSet set = foldLineSet(args, 2, count);
        PointLineMap map = new PointLineMap(set.getLineSegments());
        List<FlatFoldabilityViolation> violations = new ArrayList<>();
        for (Point point : map.getPoints()) {
            Check4.findFlatfoldabilityViolation(point, map.getLines(point)).ifPresent(violations::add);
        }
        System.out.println("dirty|true");
        printFlatFoldabilityViolations(violations);
    }

    private static void foldLineDelV(String[] args) {
        if (args.length < 6) {
            usage("foldline-del-v expects point, snap radius, vertex radius, count, and segment payload");
        }

        Point point = new Point(parse(args[1]), parse(args[2]));
        double snapRadius = parse(args[3]);
        double vertexRadius = parse(args[4]);
        int count = Integer.parseInt(args[5]);
        FoldLineSet set = foldLineSet(args, 6, count);
        boolean result = set.del_V(point, snapRadius, vertexRadius);
        System.out.println("result|" + result);
        printFoldLineSet(set);
    }

    private static void foldLineDelVCc(String[] args) {
        if (args.length < 6) {
            usage("foldline-del-v-cc expects point, snap radius, vertex radius, count, and segment payload");
        }

        Point point = new Point(parse(args[1]), parse(args[2]));
        double snapRadius = parse(args[3]);
        double vertexRadius = parse(args[4]);
        int count = Integer.parseInt(args[5]);
        FoldLineSet set = foldLineSet(args, 6, count);
        boolean result = set.del_V_cc(point, snapRadius, vertexRadius);
        System.out.println("result|" + result);
        printFoldLineSet(set);
    }

    private static void foldLineDelVPair(String[] args) {
        if (args.length < 4) {
            usage("foldline-del-v-pair expects i, j, count, and segment payload");
        }

        int i = Integer.parseInt(args[1]);
        int j = Integer.parseInt(args[2]);
        int count = Integer.parseInt(args[3]);
        FoldLineSet set = foldLineSet(args, 4, count);
        LineSegment result = set.del_V(set.get(i + 1), set.get(j + 1));
        if (result == null) {
            System.out.println("result|null");
        } else {
            System.out.println("result|"
                    + result.determineAX() + "|"
                    + result.determineAY() + "|"
                    + result.determineBX() + "|"
                    + result.determineBY() + "|"
                    + result.getColor().getNumber());
        }
        printFoldLineSet(set);
    }

    private static void foldLineDelVAll(String[] args) throws Exception {
        if (args.length < 2) {
            usage("foldline-del-v-all expects count and segment payload");
        }

        int count = Integer.parseInt(args[1]);
        FoldLineSet set = foldLineSet(args, 2, count);
        set.del_V_all();
        printFoldLineSet(set);
    }

    private static void foldLineDelVAllCc(String[] args) throws Exception {
        if (args.length < 2) {
            usage("foldline-del-v-all-cc expects count and segment payload");
        }

        int count = Integer.parseInt(args[1]);
        FoldLineSet set = foldLineSet(args, 2, count);
        set.del_V_all_cc();
        printFoldLineSet(set);
    }

    private static void foldLineFix1(String[] args) {
        if (args.length < 2) {
            usage("foldline-fix1 expects count and segment payload");
        }

        int count = Integer.parseInt(args[1]);
        FoldLineSet set = foldLineSet(args, 2, count);
        boolean result = Fix1.apply(set);
        System.out.println("result|" + result);
        printFoldLineSetWithSelection(set);
    }

    private static void foldLineFix2(String[] args) {
        if (args.length < 2) {
            usage("foldline-fix2 expects count and segment payload");
        }

        int count = Integer.parseInt(args[1]);
        FoldLineSet set = foldLineSet(args, 2, count);
        Fix2.apply(set);
        printFoldLineSetWithSelection(set);
    }

    private static void foldLineFixInaccurate(String[] args) throws Exception {
        if (args.length < 6) {
            usage("foldline-fix-inaccurate expects useBP, use22_5, precision, indices, count, and segment payload");
        }

        boolean useBp = Boolean.parseBoolean(args[1]);
        boolean use22_5 = Boolean.parseBoolean(args[2]);
        double precision = parse(args[3]);
        String indices = args[4];
        int count = Integer.parseInt(args[5]);
        FoldLineSet set = foldLineSet(args, 6, count);
        List<LineSegment> selectedLines = selectedFoldLines(set, indices)
                .stream()
                .filter(line -> line.getColor().isFoldingLine())
                .toList();

        boolean applied = false;
        boolean warning = false;
        OracleFixXform xform = oracleFixXform(selectedLines);
        ArrayList<LineSegment> transformed = oracleDoXform(selectedLines, xform);
        ArrayList<Double> toFix = new ArrayList<>();
        for (LineSegment segment : transformed) {
            toFix.add(segment.getA().getX());
            toFix.add(segment.getA().getY());
            toFix.add(segment.getB().getX());
            toFix.add(segment.getB().getY());
        }

        OracleFixerResult result = oracleFix(toFix, useBp, use22_5, precision);
        String type = result.type.name();
        long numFixedLines = result.numFixedLines;
        long numFixableLines = result.numFixableLines;
        ArrayList<Double> fixedValues = result.lines;

        if (!selectedLines.isEmpty()
                && !type.equals("EMPTY")
                && numFixableLines != 0
                && !fixedValues.isEmpty()) {
            warning = type.equals("PURE_22_5")
                    && !xform.inDefaultSquare
                    && !xform.isSquare;
            fixedValues = oracleUndoXform(fixedValues, xform);

            int i = 0;
            for (LineSegment line : selectedLines) {
                set.deleteLine(line);
                LineSegment fixed = line.withCoordinates(
                        fixedValues.get(i),
                        fixedValues.get(i + 1),
                        fixedValues.get(i + 2),
                        fixedValues.get(i + 3));
                set.addLine(fixed);
                i += 4;
            }

            set.divideLineSegmentWithNewLines(set.getTotal() - selectedLines.size(), set.getTotal());
            applied = true;
        }

        System.out.println("result|" + type + "|" + numFixedLines + "|" + numFixableLines
                + "|" + applied + "|" + warning);
        printFoldLineSet(set);
    }

    private static void foldLineSetColor(String[] args) {
        if (args.length < 4) {
            usage("foldline-set-color expects color, comma-separated indices, count, and segment payload");
        }

        LineColor color = LineColor.fromNumber(Integer.parseInt(args[1]));
        int count = Integer.parseInt(args[3]);
        FoldLineSet set = foldLineSet(args, 4, count);
        List<LineSegment> lines = selectedFoldLines(set, args[2]);
        int changed = set.setColor(lines, color);
        System.out.println("changed|" + changed);
        printFoldLineSet(set);
    }

    private static void foldLineChangeType(String[] args) {
        if (args.length < 3) {
            usage("foldline-change-type expects index, count, and segment payload");
        }

        int index = Integer.parseInt(args[1]);
        int count = Integer.parseInt(args[2]);
        FoldLineSet set = foldLineSet(args, 3, count);
        boolean changed = false;
        if (index >= 0 && index < set.getTotal()) {
            LineSegment segment = new LineSegment(set.get(index + 1));
            LineColor color = segment.getColor();
            if (color.isFoldingLine()) {
                set.setColor(segment, color.advanceFolding());
                changed = true;
            }
        }
        System.out.println("changed|" + changed);
        printFoldLineSet(set);
    }

    private static void foldLineMakeColor(String[] args) {
        if (args.length < 4) {
            usage("foldline-make-color expects color, comma-separated indices, count, and segment payload");
        }

        LineColor color = LineColor.fromNumber(Integer.parseInt(args[1]));
        int count = Integer.parseInt(args[3]);
        FoldLineSet set = foldLineSet(args, 4, count);
        List<LineSegment> lines = selectedFoldLines(set, args[2])
                .stream()
                .filter(line -> line.getColor() != color)
                .toList();
        int changed = 0;
        if (!lines.isEmpty()) {
            changed = set.setColor(lines, color);
            Fix2.apply(set);
        }
        System.out.println("changed|" + changed);
        printFoldLineSet(set);
    }

    private static void foldLineMakeAux(String[] args) {
        if (args.length < 3) {
            usage("foldline-make-aux expects comma-separated indices, count, and segment payload");
        }

        int count = Integer.parseInt(args[2]);
        FoldLineSet set = foldLineSet(args, 3, count);
        List<LineSegment> lines = selectedFoldLines(set, args[1])
                .stream()
                .filter(line -> line.getColor().isFoldingLine())
                .toList();

        for (LineSegment line : lines) {
            LineSegment addSen = line.withColor(LineColor.CYAN_3);
            set.deleteLine(line);
            set.addLine(addSen);
        }
        if (!lines.isEmpty()) {
            set.divideLineSegmentWithNewLines(set.getTotal() - lines.size(), set.getTotal());
        }

        System.out.println("changed|" + lines.size());
        printFoldLineSet(set);
    }

    private static void foldLineChangeMv(String[] args) {
        if (args.length < 3) {
            usage("foldline-change-mv expects comma-separated indices, count, and segment payload");
        }

        int count = Integer.parseInt(args[2]);
        FoldLineSet set = foldLineSet(args, 3, count);
        for (LineSegment line : selectedFoldLines(set, args[1])) {
            set.setColor(line, line.getColor().changeMV());
        }
        printFoldLineSet(set);
    }

    private static void foldLineAdvanceType(String[] args) {
        if (args.length < 3) {
            usage("foldline-advance-type expects index, count, and segment payload");
        }

        int index = Integer.parseInt(args[1]);
        int count = Integer.parseInt(args[2]);
        FoldLineSet set = foldLineSet(args, 3, count);
        boolean result = false;
        if (index >= 0 && index < set.getTotal()) {
            LineSegment lineSegment = set.get(index + 1);
            set.deleteLine(lineSegment);

            LineColor color = lineSegment.getColor();
            int selected = lineSegment.getSelected();
            if ((color == LineColor.BLACK_0) && (selected == 0)) {
                lineSegment.setSelected(2);
            } else if ((color == LineColor.BLACK_0) && (selected == 2)) {
                lineSegment = lineSegment.withColor(LineColor.RED_1);
                lineSegment.setSelected(0);
            } else if ((color == LineColor.RED_1) && (selected == 0)) {
                lineSegment = lineSegment.withColor(LineColor.BLUE_2);
            } else if ((color == LineColor.BLUE_2) && (selected == 0)) {
                lineSegment = lineSegment.withColor(LineColor.BLACK_0);
            }

            set.addLine(lineSegment);
            result = true;
        }
        System.out.println("result|" + result);
        printFoldLineSetWithSelection(set);
    }

    private static void foldLineAlternateMv(String[] args) {
        if (args.length < 8) {
            usage("foldline-alternate-mv expects start color, guide segment, count, and segment payload");
        }

        LineColor startColor = LineColor.fromNumber(Integer.parseInt(args[1]));
        LineSegment guide = new LineSegment(
                new Point(parse(args[2]), parse(args[3])),
                new Point(parse(args[4]), parse(args[5])),
                LineColor.fromNumber(Integer.parseInt(args[6])));
        int count = Integer.parseInt(args[7]);
        FoldLineSet set = foldLineSet(args, 8, count);
        int changed = 0;

        if (Epsilon.high.gt0(guide.determineLength())) {
            SortingBox<LineSegment> sorted = new SortingBox<>();
            for (LineSegment line : set.getLineSegmentsIterable()) {
                if (OritaCalc.isLineSegmentOverlapping(line, guide)) {
                    sorted.addByWeight(line, OritaCalc.determineLineSegmentDistance(guide.getA(), line));
                }
            }

            LineColor color = startColor;
            for (int i = 1; i <= sorted.getTotal(); i++) {
                set.setColor(sorted.getValue(i), color);
                changed++;
                if (color == LineColor.RED_1) {
                    color = LineColor.BLUE_2;
                } else if (color == LineColor.BLUE_2) {
                    color = LineColor.RED_1;
                }
            }
        }

        System.out.println("changed|" + changed);
        printFoldLineSet(set);
    }

    private static void foldLineAlternateMvCrossing(String[] args) {
        if (args.length < 8) {
            usage("foldline-alternate-mv-crossing expects start color, guide segment, count, and segment payload");
        }

        LineColor startColor = LineColor.fromNumber(Integer.parseInt(args[1]));
        LineSegment guide = new LineSegment(
                new Point(parse(args[2]), parse(args[3])),
                new Point(parse(args[4]), parse(args[5])),
                LineColor.fromNumber(Integer.parseInt(args[6])));
        int count = Integer.parseInt(args[7]);
        FoldLineSet set = foldLineSet(args, 8, count);
        int changed = 0;

        if (Epsilon.high.gt0(guide.determineLength())) {
            SortingBox<LineSegment> sorted = new SortingBox<>();
            for (LineSegment line : set.getLineSegmentsIterable()) {
                LineSegment.Intersection intersection = OritaCalc.determineLineSegmentIntersection(
                        line,
                        guide,
                        Epsilon.UNKNOWN_1EN4);
                if (!(intersection == LineSegment.Intersection.INTERSECTS_1
                        || intersection == LineSegment.Intersection.INTERSECTS_TSHAPE_S2_VERTICAL_BAR_27
                        || intersection == LineSegment.Intersection.INTERSECTS_TSHAPE_S2_VERTICAL_BAR_28)) {
                    continue;
                }
                sorted.addByWeight(
                        line,
                        OritaCalc.distance(guide.getB(), OritaCalc.findIntersection(line, guide)));
            }

            LineColor color = startColor;
            for (int i = 1; i <= sorted.getTotal(); i++) {
                set.setColor(sorted.getValue(i), color);
                changed++;
                if (color == LineColor.RED_1) {
                    color = LineColor.BLUE_2;
                } else if (color == LineColor.BLUE_2) {
                    color = LineColor.RED_1;
                }
            }
        }

        System.out.println("changed|" + changed);
        printFoldLineSet(set);
    }

    private static void foldLineSelectAll(String[] args) {
        if (args.length < 4) {
            usage("foldline-select-all expects action, preselected indices, count, and segment payload");
        }

        String action = args[1];
        int count = Integer.parseInt(args[3]);
        FoldLineSet set = foldLineSet(args, 4, count);
        applySelectedIndices(set, args[2], 2);

        switch (action) {
            case "select" -> set.select_all();
            case "unselect" -> set.unselect_all();
            default -> usage("unknown select-all action: " + action);
        }

        printFoldLineSetWithSelection(set);
    }

    private static void foldLineSelectIndices(String[] args) {
        if (args.length < 5) {
            usage("foldline-select-indices expects action, indices, preselected indices, count, and segment payload");
        }

        String action = args[1];
        int count = Integer.parseInt(args[4]);
        FoldLineSet set = foldLineSet(args, 5, count);
        applySelectedIndices(set, args[3], 2);

        for (int index : parseIndices(args[2])) {
            switch (action) {
                case "select" -> set.select(index + 1);
                case "unselect" -> set.get(index + 1).setSelected(0);
                default -> usage("unknown select-indices action: " + action);
            }
        }

        printFoldLineSetWithSelection(set);
    }

    private static void foldLineSelectBox(String[] args) {
        if (args.length < 5) {
            usage("foldline-select-box expects action, preselected indices, vertex count, vertices, count, and segment payload");
        }

        String action = args[1];
        int vertexCount = Integer.parseInt(args[3]);
        int countOffset = 4 + vertexCount * 2;
        int count = Integer.parseInt(args[countOffset]);
        FoldLineSet set = foldLineSet(args, countOffset + 1, count);
        applySelectedIndices(set, args[2], 2);
        Polygon polygon = polygon(args, 4, vertexCount);

        for (LineSegment line : set.lineSegmentsInside(polygon)) {
            switch (action) {
                case "select" -> line.setSelected(2);
                case "unselect" -> line.setSelected(0);
                default -> usage("unknown select-box action: " + action);
            }
        }

        printFoldLineSetWithSelection(set);
    }

    private static void foldLineSelectPolygon(String[] args) {
        if (args.length < 5) {
            usage("foldline-select-polygon expects action, preselected indices, vertex count, vertices, count, and segment payload");
        }

        String action = args[1];
        int vertexCount = Integer.parseInt(args[3]);
        int countOffset = 4 + vertexCount * 2;
        int count = Integer.parseInt(args[countOffset]);
        FoldLineSet set = foldLineSet(args, countOffset + 1, count);
        applySelectedIndices(set, args[2], 2);
        Polygon polygon = polygon(args, 4, vertexCount);

        switch (action) {
            case "select" -> set.select_Takakukei(polygon, "select");
            case "unselect" -> set.select_Takakukei(polygon, "unselectAction");
            default -> usage("unknown select-polygon action: " + action);
        }

        printFoldLineSetWithSelection(set);
    }

    private static void foldLineSelectLasso(String[] args) {
        if (args.length < 5) {
            usage("foldline-select-lasso expects action, preselected indices, vertex count, vertices, count, and segment payload");
        }

        String action = args[1];
        int vertexCount = Integer.parseInt(args[3]);
        int countOffset = 4 + vertexCount * 2;
        int count = Integer.parseInt(args[countOffset]);
        FoldLineSet set = foldLineSet(args, countOffset + 1, count);
        applySelectedIndices(set, args[2], 2);
        Path2D path = path(args, 4, vertexCount);

        switch (action) {
            case "select" -> set.select_lasso(path, SelectMode.SELECT, LassoInteractionMode.INTERSECT_CONTAIN);
            case "unselect" -> set.select_lasso(path, SelectMode.UNSELECT, LassoInteractionMode.INTERSECT_CONTAIN);
            default -> usage("unknown select-lasso action: " + action);
        }

        printFoldLineSetWithSelection(set);
    }

    private static void foldLineSelectLx(String[] args) {
        if (args.length < 9) {
            usage("foldline-select-lx expects action, preselected indices, selection segment, count, and segment payload");
        }

        String action = args[1];
        LineSegment selection = new LineSegment(
                new Point(parse(args[3]), parse(args[4])),
                new Point(parse(args[5]), parse(args[6])),
                LineColor.fromNumber(Integer.parseInt(args[7])));
        int count = Integer.parseInt(args[8]);
        FoldLineSet set = foldLineSet(args, 9, count);
        applySelectedIndices(set, args[2], 2);

        switch (action) {
            case "select" -> set.select_lX(selection, "select_lX");
            case "unselect" -> set.select_lX(selection, "unselect_lX");
            default -> usage("unknown select-lx action: " + action);
        }

        printFoldLineSetWithSelection(set);
    }

    private static void foldLineSelectConnected(String[] args) {
        if (args.length < 5) {
            usage("foldline-select-connected expects point, preselected indices, count, and segment payload");
        }

        Point point = new Point(parse(args[1]), parse(args[2]));
        int count = Integer.parseInt(args[4]);
        FoldLineSet set = foldLineSet(args, 5, count);
        applySelectedIndices(set, args[3], 2);
        set.selectProbablyConnected(point);
        printFoldLineSetWithSelection(set);
    }

    private static void foldLineDeleteSelected(String[] args) {
        if (args.length < 3) {
            usage("foldline-delete-selected expects preselected indices, count, and segment payload");
        }

        int count = Integer.parseInt(args[2]);
        FoldLineSet set = foldLineSet(args, 3, count);
        applySelectedIndices(set, args[1], 2);
        set.delSelectedLineSegmentFast();
        printFoldLineSetWithSelection(set);
    }

    private static void foldLineReplaceType(String[] args) {
        if (args.length < 5) {
            usage("foldline-replace-type expects from type, to type, indices, count, and segment payload");
        }

        CustomLineTypes from = CustomLineTypes.from(Integer.parseInt(args[1]));
        CustomLineTypes to = CustomLineTypes.from(Integer.parseInt(args[2]));
        int count = Integer.parseInt(args[4]);
        FoldLineSet set = foldLineSet(args, 5, count);
        List<LineSegment> lines = selectedFoldLines(set, args[3])
                .stream()
                .filter(line -> from.matches(line.getColor()))
                .toList();
        int changed = set.setColor(lines, to.getLineColor());
        System.out.println("changed|" + changed);
        printFoldLineSetWithSelection(set);
    }

    private static void foldLineDeleteType(String[] args) {
        if (args.length < 4) {
            usage("foldline-delete-type expects line type, indices, count, and segment payload");
        }

        CustomLineTypes lineType = CustomLineTypes.from(Integer.parseInt(args[1]));
        int count = Integer.parseInt(args[3]);
        FoldLineSet set = foldLineSet(args, 4, count);
        List<LineSegment> lines = selectedFoldLines(set, args[2])
                .stream()
                .filter(line -> lineType.matches(line.getColor()))
                .toList();
        for (LineSegment line : lines) {
            set.deleteLine(line);
        }
        printFoldLineSetWithSelection(set);
    }

    private static void foldLineTranslate(String[] args) {
        if (args.length < 4) {
            usage("foldline-translate expects dx, dy, count, and segment payload");
        }

        double dx = parse(args[1]);
        double dy = parse(args[2]);
        int count = Integer.parseInt(args[3]);
        FoldLineSet set = foldLineSet(args, 4, count);
        set.move(dx, dy);
        printFoldLineSetWithSelection(set);
    }

    private static void foldLineTransformSelected(String[] args) {
        if (args.length < 6) {
            usage("foldline-transform-selected expects mode, dx, dy, preselected indices, count, and segment payload");
        }

        String mode = args[1];
        double dx = parse(args[2]);
        double dy = parse(args[3]);
        int count = Integer.parseInt(args[5]);
        FoldLineSet set = foldLineSet(args, 6, count);
        applySelectedIndices(set, args[4], 2);

        if (Epsilon.high.gt0(new Point(dx, dy).distance(new Point(0.0, 0.0)))) {
            FoldLineSet selected = new FoldLineSet();
            Save save = SaveProvider.createInstance();
            set.getMemoSelectOption(save, 2);
            selected.setSave(save);

            switch (mode) {
                case "move" -> set.delSelectedLineSegmentFast();
                case "copy" -> {}
                default -> usage("unknown transform-selected mode: " + mode);
            }

            selected.move(dx, dy);
            if (mode.equals("copy")) {
                selected.unselect_all();
            }

            int totalOld = set.getTotal();
            Save movedSave = SaveProvider.createInstance();
            selected.getSave(movedSave);
            set.addSave(movedSave);
            int totalNew = set.getTotal();
            set.divideLineSegmentWithNewLines(totalOld, totalNew);
            set.unselect_all();
        }

        printFoldLineSetWithSelection(set);
    }

    private static void foldLineTransformSelected4p(String[] args) {
        if (args.length < 12) {
            usage("foldline-transform-selected-4p expects mode, four points, preselected indices, count, and segment payload");
        }

        String mode = args[1];
        Point originalA = new Point(parse(args[2]), parse(args[3]));
        Point originalB = new Point(parse(args[4]), parse(args[5]));
        Point targetA = new Point(parse(args[6]), parse(args[7]));
        Point targetB = new Point(parse(args[8]), parse(args[9]));
        int count = Integer.parseInt(args[11]);
        FoldLineSet set = foldLineSet(args, 12, count);
        applySelectedIndices(set, args[10], 2);

        FoldLineSet selected = new FoldLineSet();
        Save save = SaveProvider.createInstance();
        set.getMemoSelectOption(save, 2);
        selected.setSave(save);

        switch (mode) {
            case "move" -> set.delSelectedLineSegmentFast();
            case "copy" -> {}
            default -> usage("unknown transform-selected-4p mode: " + mode);
        }

        selected.move(originalA, originalB, targetA, targetB);
        if (mode.equals("copy")) {
            selected.unselect_all();
        }

        int totalOld = set.getTotal();
        Save movedSave = SaveProvider.createInstance();
        selected.getSave(movedSave);
        set.addSave(movedSave);
        int totalNew = set.getTotal();
        set.divideLineSegmentWithNewLines(totalOld, totalNew);
        set.unselect_all();
        printFoldLineSetWithSelection(set);
    }

    private static void operationFrameSequence(String[] args) {
        if (args.length < 14) {
            usage("operation-frame-sequence expects selection distance, frame, lines, circles, and events");
        }

        int cursor = 1;
        double selectionDistance = parse(args[cursor++]);
        OperationFrame frame = new OperationFrame();
        frame.setActive(Boolean.parseBoolean(args[cursor++]));
        for (int index = 0; index < 4; index++) {
            frame.setFramePoint(index, new Point(parse(args[cursor]), parse(args[cursor + 1])));
            cursor += 2;
        }

        int lineCount = Integer.parseInt(args[cursor++]);
        FoldLineSet set = new FoldLineSet();
        for (int index = 0; index < lineCount; index++) {
            LineSegment segment = segment(args, cursor);
            set.addLine(segment.getA(), segment.getB(), segment.getColor());
            cursor += 5;
        }

        int circleCount = Integer.parseInt(args[cursor++]);
        for (int index = 0; index < circleCount; index++) {
            set.getCircles().add(circle(args, cursor));
            cursor += 4;
        }

        int eventCount = Integer.parseInt(args[cursor++]);
        OperationFrameOracleMode mode = OperationFrameOracleMode.NONE_0;
        Point lastMousePos = new Point();
        for (int eventIndex = 0; eventIndex < eventCount; eventIndex++) {
            String event = args[cursor++];
            Point point = new Point(parse(args[cursor]), parse(args[cursor + 1]));
            cursor += 2;
            switch (event) {
                case "press" -> {
                    OperationFramePressResult result = operationFrameMousePressed(
                            set, frame, point, selectionDistance);
                    mode = result.mode;
                    lastMousePos = result.lastMousePos;
                }
                case "drag" -> {
                    if (mode == OperationFrameOracleMode.MOVE_POINTS_2) {
                        mode = OperationFrameOracleMode.CREATE_1;
                    }
                    Point closestPoint = closestOperationFramePoint(set, point);
                    Point snapped = point.distance(closestPoint) < selectionDistance
                            ? closestPoint
                            : point;
                    operationFrameUpdate(frame, mode, lastMousePos, snapped);
                    lastMousePos = snapped;
                }
                case "release" -> {
                    Point closestPoint = closestOperationFramePoint(set, point);
                    Point snapped = point.distance(closestPoint) <= selectionDistance
                            ? closestPoint
                            : point;
                    operationFrameUpdate(frame, mode, lastMousePos, snapped);
                    if (frame.getPolygon().calculateArea() < 1.0) {
                        frame.setActive(false);
                    }
                }
                case "reset" -> frame.setActive(false);
                default -> usage("unknown operation-frame event: " + event);
            }
        }

        if (cursor != args.length) {
            usage("operation-frame-sequence payload length mismatch");
        }

        printOperationFrame(frame, mode, lastMousePos);
    }

    private record OperationFramePressResult(OperationFrameOracleMode mode, Point lastMousePos) {
    }

    private static OperationFramePressResult operationFrameMousePressed(
            FoldLineSet set,
            OperationFrame frame,
            Point point,
            double selectionDistance) {
        Point p1 = frame.getP1();
        Point p2 = frame.getP2();
        Point p3 = frame.getP3();
        Point p4 = frame.getP4();
        OperationFrameOracleMode mode = OperationFrameOracleMode.NONE_0;
        if (!frame.isActive()) {
            mode = OperationFrameOracleMode.CREATE_1;
        }

        if (frame.isActive()) {
            double distanceMin = OritaCalc.min(
                    OritaCalc.determineLineSegmentDistance(point, p1, p2),
                    OritaCalc.determineLineSegmentDistance(point, p2, p3),
                    OritaCalc.determineLineSegmentDistance(point, p3, p4),
                    OritaCalc.determineLineSegmentDistance(point, p4, p1));
            if (distanceMin < selectionDistance) {
                mode = OperationFrameOracleMode.MOVE_SIDES_3;
            } else if (frame.getPolygon().inside(point) == Polygon.Intersection.OUTSIDE) {
                mode = OperationFrameOracleMode.CREATE_1;
            } else {
                mode = OperationFrameOracleMode.MOVE_BOX_4;
            }

            if (point.distance(p1) < selectionDistance) {
                Point moved = frame.getP1();
                frame.setFramePoint(0, frame.getP3());
                frame.setFramePoint(2, moved);
                mode = OperationFrameOracleMode.MOVE_POINTS_2;
            }
            if (point.distance(p2) < selectionDistance) {
                Point moved = frame.getP2();
                frame.setFramePoint(1, frame.getP1());
                frame.setFramePoint(0, frame.getP4());
                frame.setFramePoint(3, frame.getP3());
                frame.setFramePoint(2, moved);
                mode = OperationFrameOracleMode.MOVE_POINTS_2;
            }
            if (point.distance(p3) < selectionDistance) {
                Point moved = frame.getP3();
                frame.setFramePoint(0, frame.getP1());
                frame.setFramePoint(2, moved);
                mode = OperationFrameOracleMode.MOVE_POINTS_2;
            }
            if (point.distance(p4) < selectionDistance) {
                Point moved = frame.getP4();
                frame.setFramePoint(3, frame.getP1());
                frame.setFramePoint(0, frame.getP2());
                frame.setFramePoint(1, frame.getP3());
                frame.setFramePoint(2, moved);
                mode = OperationFrameOracleMode.MOVE_POINTS_2;
            }

            if (mode == OperationFrameOracleMode.MOVE_SIDES_3) {
                Point pOb1 = p1;
                Point pOb2 = p2;
                Point pOb3 = p3;
                Point pOb4 = p4;
                int guard = 0;
                while (OritaCalc.determineLineSegmentDistance(point, pOb1, pOb2) != distanceMin
                        && guard < 4) {
                    Point moved = frame.getP1();
                    frame.setFramePoint(0, frame.getP2());
                    frame.setFramePoint(1, frame.getP3());
                    frame.setFramePoint(2, frame.getP4());
                    frame.setFramePoint(3, moved);
                    moved = pOb1;
                    pOb1 = pOb2;
                    pOb2 = pOb3;
                    pOb3 = pOb4;
                    pOb4 = moved;
                    guard++;
                }
            }
        }

        if (mode == OperationFrameOracleMode.CREATE_1) {
            frame.setActive(true);
            Point snapped = point;
            Point closestPoint = closestOperationFramePoint(set, point);
            if (point.distance(closestPoint) < selectionDistance) {
                snapped = closestPoint;
            }
            for (int index = 0; index < 4; index++) {
                frame.setFramePoint(index, snapped);
            }
        }

        return new OperationFramePressResult(mode, point);
    }

    private static Point closestOperationFramePoint(FoldLineSet set, Point point) {
        Point closest = set.closestPoint(point);
        Point closestCenter = set.closestCenter(point);
        if (point.distanceSquared(closest) > point.distanceSquared(closestCenter)) {
            closest = closestCenter;
        }
        return closest;
    }

    private static void operationFrameUpdate(
            OperationFrame frame,
            OperationFrameOracleMode mode,
            Point lastMousePos,
            Point point) {
        if (mode == OperationFrameOracleMode.MOVE_SIDES_3) {
            if (Math.abs(frame.getP1().getX() - frame.getP2().getX())
                    < Math.abs(frame.getP1().getY() - frame.getP2().getY())) {
                frame.setFramePointX(0, point.getX());
                frame.setFramePointX(1, point.getX());
            }

            if (Math.abs(frame.getP1().getX() - frame.getP2().getX())
                    > Math.abs(frame.getP1().getY() - frame.getP2().getY())) {
                frame.setFramePointY(0, point.getY());
                frame.setFramePointY(1, point.getY());
            }
        }

        if (mode == OperationFrameOracleMode.MOVE_BOX_4) {
            for (int index = 0; index < 4; index++) {
                frame.setFramePoint(index, frame.getFramePoint(index).move(lastMousePos.delta(point)));
            }
        }

        if (mode == OperationFrameOracleMode.CREATE_1) {
            frame.setFramePoint(2, point);
            frame.setFramePoint(1, new Point(frame.getP1().getX(), frame.getP3().getY()));
            frame.setFramePoint(3, new Point(frame.getP3().getX(), frame.getP1().getY()));
        }
    }

    private static void foldLineExtendToIntersection(String[] args) {
        if (args.length < 7) {
            usage("foldline-extend-to-intersection expects segment, count, and segment payload");
        }

        LineSegment segment = new LineSegment(
                new Point(parse(args[1]), parse(args[2])),
                new Point(parse(args[3]), parse(args[4])),
                LineColor.fromNumber(Integer.parseInt(args[5])));
        int count = Integer.parseInt(args[6]);
        FoldLineSet set = foldLineSet(args, 7, count);
        LineSegment result = OritaCalc.extendToIntersectionPoint_2(set, segment);
        System.out.println("result|"
                + result.determineAX() + "|"
                + result.determineAY() + "|"
                + result.determineBX() + "|"
                + result.determineBY() + "|"
                + result.getColor().getNumber());
    }

    private static void foldLineLengthen(String[] args) {
        if (args.length < 12) {
            usage("foldline-lengthen expects color mode, line color, selection distance, selection segment, extension point, count, and segment payload");
        }

        String colorMode = args[1];
        LineColor lineColor = LineColor.fromNumber(Integer.parseInt(args[2]));
        double selectionDistance = parse(args[3]);
        LineSegment selectionLine = segment(args, 4);
        Point extensionPoint = new Point(parse(args[9]), parse(args[10]));
        int count = Integer.parseInt(args[11]);
        FoldLineSet set = foldLineSet(args, 12, count);
        LineSegment closestLineSegment = set.getClosestLineSegment(extensionPoint);
        LengthenCandidates candidates = lengthenCandidates(set, selectionLine, selectionDistance);
        selectionLine = candidates.selectionLine;
        SortingBox<LineSegment> linesToExtend = candidates.lines;
        int added = 0;

        if (linesToExtend.getTotal() > 0
                && OritaCalc.determineLineSegmentDistance(extensionPoint, closestLineSegment) < selectionDistance) {
            boolean sameLineMode = false;
            for (int index = 1; index <= linesToExtend.getTotal(); index++) {
                if (OritaCalc.determineLineSegmentIntersection(
                        linesToExtend.getValue(index),
                        closestLineSegment,
                        Epsilon.UNKNOWN_1EN6) == LineSegment.Intersection.PARALLEL_EQUAL_31) {
                    sameLineMode = true;
                }
            }

            if (!sameLineMode) {
                for (int index = 1; index <= linesToExtend.getTotal(); index++) {
                    LineSegment original = linesToExtend.getValue(index);
                    if (OritaCalc.isLineSegmentParallel(
                            original,
                            closestLineSegment,
                            Epsilon.UNKNOWN_1EN6) == OritaCalc.ParallelJudgement.NOT_PARALLEL) {
                        Point intersection = OritaCalc.findIntersection(original, closestLineSegment);
                        LineSegment addLineSegment = new LineSegment(
                                intersection,
                                original.determineClosestEndpoint(intersection));
                        if (addExtendedLengthenLine(set, addLineSegment, original, colorMode, lineColor)) {
                            added++;
                        }
                    }
                }
            } else {
                for (int index = 1; index <= linesToExtend.getTotal(); index++) {
                    LineSegment lineToExtend = new LineSegment(linesToExtend.getValue(index));
                    Point intersection = OritaCalc.findIntersection(lineToExtend, selectionLine);
                    if (intersection.distance(lineToExtend.getA()) < intersection.distance(lineToExtend.getB())) {
                        lineToExtend = lineToExtend.withSwappedCoordinates();
                    }
                    LineSegment addLineSegment = OritaCalc.extendToIntersectionPoint_2(set, lineToExtend);
                    if (addExtendedLengthenLine(set, addLineSegment, lineToExtend, colorMode, lineColor)) {
                        added++;
                    }
                }
            }
        }

        System.out.println("added|" + added);
        printFoldLineSet(set);
    }

    private static LengthenCandidates lengthenCandidates(
            FoldLineSet set,
            LineSegment selectionLine,
            double selectionDistance) {
        SortingBox<LineSegment> linesToExtend = new SortingBox<>();
        linesToExtend.reset();
        for (LineSegment line : set.getLineSegmentsIterable()) {
            LineSegment.Intersection intersection = OritaCalc.determineLineSegmentIntersection(
                    line,
                    selectionLine,
                    Epsilon.UNKNOWN_1EN4);
            if (intersection == LineSegment.Intersection.INTERSECTS_1) {
                linesToExtend.addByWeight(
                        line,
                        OritaCalc.distance(selectionLine.getA(), OritaCalc.findIntersection(line, selectionLine)));
            }
        }

        if (linesToExtend.getTotal() == 0 && selectionLine.determineLength() <= Epsilon.UNKNOWN_1EN6) {
            LineSegment closestLine = set.closestLineSegmentSearch(selectionLine.getB());
            if (closestLine != null
                    && OritaCalc.determineLineSegmentDistance(selectionLine.getB(), closestLine) < selectionDistance) {
                linesToExtend.addByWeight(closestLine, 1.0);
                Point newPoint = OritaCalc.findProjection(closestLine, selectionLine.getB());
                if (OritaCalc.determineLineSegmentDistance(newPoint, closestLine) > Epsilon.UNKNOWN_1EN6) {
                    newPoint = closestLine.determineClosestEndpoint(newPoint);
                }
                selectionLine = selectionLine.withCoordinates(newPoint, newPoint);
            }
        }

        return new LengthenCandidates(selectionLine, linesToExtend);
    }

    private static class LengthenCandidates {
        final LineSegment selectionLine;
        final SortingBox<LineSegment> lines;

        LengthenCandidates(LineSegment selectionLine, SortingBox<LineSegment> lines) {
            this.selectionLine = selectionLine;
            this.lines = lines;
        }
    }

    private static boolean addExtendedLengthenLine(
            FoldLineSet set,
            LineSegment addLineSegment,
            LineSegment original,
            String colorMode,
            LineColor lineColor) {
        if (!Epsilon.high.gt0(addLineSegment.determineLength())) {
            return false;
        }
        switch (colorMode) {
            case "current" -> addLineSegment = addLineSegment.withColor(lineColor);
            case "same" -> addLineSegment = addLineSegment.withColor(original.getColor());
            default -> usage("unknown lengthen color mode: " + colorMode);
        }
        set.addLine(addLineSegment);
        set.divideLineSegmentWithNewLines(set.getTotal() - 1, set.getTotal());
        return true;
    }

    private static void foldLineParallelDraw(String[] args) {
        if (args.length < 15) {
            usage("foldline-parallel-draw expects target point, parallel segment, destination segment, color, count, and segment payload");
        }

        Point targetPoint = new Point(parse(args[1]), parse(args[2]));
        LineSegment parallelSegment = segment(args, 3);
        LineSegment destinationSegment = segment(args, 8);
        LineColor color = LineColor.fromNumber(Integer.parseInt(args[13]));
        int count = Integer.parseInt(args[14]);
        FoldLineSet set = foldLineSet(args, 15, count);
        LineSegment guide = new LineSegment(targetPoint, new Point(
                targetPoint.getX() + parallelSegment.determineBX() - parallelSegment.determineAX(),
                targetPoint.getY() + parallelSegment.determineBY() - parallelSegment.determineAY()));
        LineSegment result = additionalIntersection(guide, destinationSegment, color);
        boolean added = result != null;
        if (added) {
            addLineSegmentLikeWorker(set, result);
        }

        System.out.println("added|" + added);
        printFoldLineSet(set);
    }

    private static void foldLineParallelWidth(String[] args) {
        if (args.length < 10) {
            usage("foldline-parallel-width expects selected segment, width, choice, color, count, and segment payload");
        }

        LineSegment selectedSegment = segment(args, 1);
        double width = parse(args[6]);
        int choice = Integer.parseInt(args[7]);
        LineColor color = LineColor.fromNumber(Integer.parseInt(args[8]));
        int count = Integer.parseInt(args[9]);
        FoldLineSet set = foldLineSet(args, 10, count);
        List<LineSegment> indicators = List.of(
                OritaCalc.moveParallel(selectedSegment, width).withColor(LineColor.PURPLE_8),
                OritaCalc.moveParallel(selectedSegment, -width).withColor(LineColor.PURPLE_8));
        LineSegment selected = indicators.get(choice).withColor(color);
        boolean added = Epsilon.high.gt0(selected.determineLength());
        if (added) {
            addLineSegmentLikeWorker(set, selected);
        }

        System.out.println("added|" + added);
        printFoldLineSet(set);
    }

    private static LineSegment additionalIntersection(
            LineSegment guide,
            LineSegment destination,
            LineColor color) {
        Point crossPoint;
        OritaCalc.ParallelJudgement parallel = OritaCalc.isLineSegmentParallel(
                guide,
                destination,
                Epsilon.UNKNOWN_1EN7);
        if (parallel == OritaCalc.ParallelJudgement.PARALLEL_NOT_EQUAL) {
            return null;
        }
        if (parallel == OritaCalc.ParallelJudgement.PARALLEL_EQUAL) {
            crossPoint = destination.getA();
            if (OritaCalc.distance(guide.getA(), destination.getA())
                    > OritaCalc.distance(guide.getA(), destination.getB())) {
                crossPoint = destination.getB();
            }
        } else {
            crossPoint = OritaCalc.findIntersection(guide, destination);
        }

        LineSegment result = new LineSegment(crossPoint, guide.getA(), color);
        if (Epsilon.high.gt0(result.determineLength())) {
            return result;
        }
        return null;
    }

    private static void foldLinePerpendicularProjection(String[] args) {
        if (args.length < 10) {
            usage("foldline-perpendicular-projection expects target point, base segment, color, count, and segment payload");
        }

        Point targetPoint = new Point(parse(args[1]), parse(args[2]));
        LineSegment base = segment(args, 3);
        LineColor color = LineColor.fromNumber(Integer.parseInt(args[8]));
        int count = Integer.parseInt(args[9]);
        FoldLineSet set = foldLineSet(args, 10, count);
        LineSegment result = new LineSegment(
                targetPoint,
                OritaCalc.findProjection(OritaCalc.lineSegmentToStraightLine(base), targetPoint),
                color);
        boolean added = Epsilon.high.gt0(result.determineLength());
        if (added) {
            addLineSegmentLikeWorker(set, result);
        }

        System.out.println("added|" + added);
        printFoldLineSet(set);
    }

    private static void foldLinePerpendicularIndicator(String[] args) {
        if (args.length < 9) {
            usage("foldline-perpendicular-indicator expects target point, base segment, count, and segment payload");
        }

        Point targetPoint = new Point(parse(args[1]), parse(args[2]));
        LineSegment base = segment(args, 3);
        int count = Integer.parseInt(args[8]);
        FoldLineSet set = foldLineSet(args, 9, count);
        LineSegment result = null;
        if (OritaCalc.isPointWithinLineSpan(targetPoint, base)) {
            LineSegment indicator = OritaCalc.fullExtendUntilHit(
                    set,
                    new LineSegment(
                            targetPoint,
                            OritaCalc.findProjection(OritaCalc.moveParallel(base, 1.0), targetPoint),
                            LineColor.PURPLE_8));
            result = OritaCalc.fullExtendUntilHit(set, indicator.withCoordinates(indicator.getB(), indicator.getA()));
        }

        if (result == null) {
            System.out.println("result|null");
        } else {
            System.out.println("result|"
                    + result.determineAX() + "|"
                    + result.determineAY() + "|"
                    + result.determineBX() + "|"
                    + result.determineBY() + "|"
                    + result.getColor().getNumber());
        }
    }

    private static void foldLineAxiom5Indicator(String[] args) {
        if (args.length < 11) {
            usage("foldline-axiom5-indicator expects target point, target segment, pivot point, count, and segment payload");
        }

        Point targetPoint = new Point(parse(args[1]), parse(args[2]));
        LineSegment targetSegment = segment(args, 3);
        Point pivotPoint = new Point(parse(args[8]), parse(args[9]));
        int count = Integer.parseInt(args[10]);
        FoldLineSet set = foldLineSet(args, 11, count);
        LineSegmentPair indicators = axiom5Indicators(set, targetPoint, targetSegment, pivotPoint);
        List<LineSegment> results = new ArrayList<>();
        if (indicators != null) {
            results.add(indicators.first);
            results.add(indicators.second);
        }
        printLineSegmentsList(results);
    }

    private static void foldLineAxiom5Commit(String[] args) {
        if (args.length < 8) {
            usage("foldline-axiom5-commit expects indicator segment, color, count, and segment payload");
        }

        LineSegment indicator = segment(args, 1);
        LineColor color = LineColor.fromNumber(Integer.parseInt(args[6]));
        int count = Integer.parseInt(args[7]);
        FoldLineSet set = foldLineSet(args, 8, count);
        LineSegment result = OritaCalc.fullExtendUntilHit(
                set,
                new LineSegment(indicator.getB(), indicator.getA(), color));
        boolean added = Epsilon.high.gt0(result.determineLength());
        if (added) {
            addLineSegmentLikeWorker(set, result);
        }

        System.out.println("added|" + added);
        printFoldLineSet(set);
    }

    private static void foldLineAxiom5Destination(String[] args) {
        if (args.length < 22) {
            usage("foldline-axiom5-destination expects pivot point, two indicators, destination, pointer, color, count, and segment payload");
        }

        Point pivotPoint = new Point(parse(args[1]), parse(args[2]));
        LineSegment indicator1 = segment(args, 3);
        LineSegment indicator2 = segment(args, 8);
        LineSegment destination = segment(args, 13);
        Point pointer = new Point(parse(args[18]), parse(args[19]));
        LineColor color = LineColor.fromNumber(Integer.parseInt(args[20]));
        int count = Integer.parseInt(args[21]);
        FoldLineSet set = foldLineSet(args, 22, count);

        Point intersection1 = OritaCalc.findIntersection(indicator1, destination);
        Point intersection2 = OritaCalc.findIntersection(indicator2, destination);
        Point target = pointer.distance(intersection1) < pointer.distance(intersection2)
                ? intersection1
                : intersection2;
        LineSegment result = new LineSegment(pivotPoint, target, color);
        boolean added = Epsilon.high.gt0(result.determineLength());
        if (added) {
            addLineSegmentLikeWorker(set, result);
        }

        System.out.println("added|" + added);
        printFoldLineSet(set);
    }

    private static LineSegmentPair axiom5Indicators(
            FoldLineSet set,
            Point targetPoint,
            LineSegment targetSegment,
            Point pivotPoint) {
        if (OritaCalc.distance(pivotPoint, targetPoint) <= Epsilon.UNKNOWN_1EN7) {
            return null;
        }
        if (OritaCalc.isPointWithinLineSpan(pivotPoint, targetSegment)
                && OritaCalc.isPointWithinLineSpan(targetPoint, targetSegment)) {
            return null;
        }

        double radius = OritaCalc.distance(targetPoint, pivotPoint);
        if (radius <= Epsilon.UNKNOWN_1EN7) {
            return null;
        }

        double lengthA = 0.0;
        if (!OritaCalc.isPointWithinLineSpan(pivotPoint, targetSegment)) {
            lengthA = OritaCalc.distance(pivotPoint, OritaCalc.findProjection(targetSegment, pivotPoint));
        }

        if (Math.abs(lengthA - radius) < Epsilon.UNKNOWN_1EN7) {
            return axiom5TangentIndicators(set, targetPoint, targetSegment, pivotPoint);
        }
        if (lengthA > radius) {
            return null;
        }

        LineSegment base = new LineSegment(targetPoint, pivotPoint);
        Point projectPoint = OritaCalc.findProjection(targetSegment, pivotPoint);
        double lengthB = Math.sqrt((radius * radius) - (lengthA * lengthA));
        LineSegment first = axiom5ProjectedLineOfIndicator(pivotPoint, projectPoint, lengthB);
        LineSegment second = axiom5ProjectedLineOfIndicator(pivotPoint, projectPoint, -lengthB);
        LineSegmentPair adjusted = axiom5ProcessPivotWithinSegmentSpan(first, second, targetSegment, pivotPoint);
        first = adjusted.first;
        second = adjusted.second;

        Point center1 = axiom5ProcessCenter(pivotPoint, base, first);
        Point center2 = axiom5ProcessCenter(pivotPoint, base, second);
        return axiom5DetermineIndicators(
                set, base, first, second, pivotPoint, center1, center2, targetPoint, targetSegment);
    }

    private static LineSegmentPair axiom5TangentIndicators(
            FoldLineSet set,
            Point targetPoint,
            LineSegment targetSegment,
            Point pivotPoint) {
        Point projectionPoint = OritaCalc.findProjection(targetSegment, pivotPoint);
        LineSegment projectionLine = new LineSegment(pivotPoint, projectionPoint);

        if (OritaCalc.isPointWithinLineSpan(targetPoint, projectionLine)) {
            if (OritaCalc.distance(projectionPoint, targetPoint) < Epsilon.UNKNOWN_1EN7) {
                Point midpoint = OritaCalc.midPoint(pivotPoint, projectionPoint);
                return new LineSegmentPair(
                        OritaCalc.fullExtendUntilHit(set, new LineSegment(midpoint,
                                OritaCalc.findProjection(OritaCalc.moveParallel(projectionLine, -1.0), midpoint),
                                LineColor.PURPLE_8)),
                        OritaCalc.fullExtendUntilHit(set, new LineSegment(midpoint,
                                OritaCalc.findProjection(OritaCalc.moveParallel(projectionLine, 1.0), midpoint),
                                LineColor.PURPLE_8)));
            }

            return new LineSegmentPair(
                    OritaCalc.fullExtendUntilHit(set, new LineSegment(pivotPoint,
                            OritaCalc.findProjection(OritaCalc.moveParallel(projectionLine, 1.0), pivotPoint),
                            LineColor.PURPLE_8)),
                    OritaCalc.fullExtendUntilHit(set, new LineSegment(pivotPoint,
                            OritaCalc.findProjection(OritaCalc.moveParallel(projectionLine, -1.0), pivotPoint),
                            LineColor.PURPLE_8)));
        }

        LineSegment result;
        if (OritaCalc.isLineSegmentParallel(new LineSegment(pivotPoint, targetPoint), projectionLine)
                == OritaCalc.ParallelJudgement.NOT_PARALLEL) {
            result = OritaCalc.fullExtendUntilHit(set, new LineSegment(
                    pivotPoint,
                    OritaCalc.center(pivotPoint, targetPoint, projectionPoint),
                    LineColor.PURPLE_8));
        } else {
            result = OritaCalc.fullExtendUntilHit(set, new LineSegment(pivotPoint, projectionPoint, LineColor.PURPLE_8));
        }
        return new LineSegmentPair(result, result);
    }

    private static LineSegment axiom5ProjectedLineOfIndicator(Point pivot, Point projectPoint, double length) {
        LineSegment projectLine = new LineSegment(pivot, projectPoint);
        return new LineSegment(pivot, OritaCalc.findProjection(OritaCalc.moveParallel(projectLine, length), projectPoint));
    }

    private static Point axiom5ProcessCenter(Point pivot, LineSegment first, LineSegment second) {
        if (OritaCalc.isLineSegmentParallel(
                new StraightLine(first.determineFurthestEndpoint(pivot), pivot),
                new StraightLine(pivot, second.determineFurthestEndpoint(pivot)))
                == OritaCalc.ParallelJudgement.PARALLEL_EQUAL) {
            LineSegment segment = new LineSegment(pivot, OritaCalc.findProjection(OritaCalc.moveParallel(first, 1.0), pivot));
            return OritaCalc.center(
                    first.determineFurthestEndpoint(pivot),
                    second.determineFurthestEndpoint(pivot),
                    segment.determineFurthestEndpoint(pivot));
        }
        return OritaCalc.center(pivot, second.determineFurthestEndpoint(pivot), first.determineFurthestEndpoint(pivot));
    }

    private static LineSegmentPair axiom5ProcessPivotWithinSegmentSpan(
            LineSegment first,
            LineSegment second,
            LineSegment targetSegment,
            Point pivot) {
        if (OritaCalc.isPointWithinLineSpan(pivot, targetSegment)) {
            if (OritaCalc.distance(pivot, targetSegment.getA()) < Epsilon.UNKNOWN_1EN7) {
                return new LineSegmentPair(
                        new LineSegment(pivot, OritaCalc.point_rotate(pivot, targetSegment.getB(), 180)),
                        new LineSegment(pivot, targetSegment.getB()));
            }
            if (OritaCalc.distance(pivot, targetSegment.getB()) < Epsilon.UNKNOWN_1EN7) {
                return new LineSegmentPair(
                        new LineSegment(pivot, targetSegment.getA()),
                        new LineSegment(pivot, OritaCalc.point_rotate(pivot, targetSegment.getA(), 180)));
            }

            boolean outsideA = targetSegment.determineLength() > OritaCalc.distance(targetSegment.getA(), pivot)
                    && OritaCalc.distance(targetSegment.getB(), pivot) > targetSegment.determineLength();
            boolean outsideB = targetSegment.determineLength() > OritaCalc.distance(targetSegment.getB(), pivot)
                    && OritaCalc.distance(targetSegment.getA(), pivot) > targetSegment.determineLength();

            first = new LineSegment(pivot,
                    outsideA ? OritaCalc.point_rotate(pivot, targetSegment.getB(), 180) : targetSegment.getA());
            second = new LineSegment(pivot,
                    outsideB ? OritaCalc.point_rotate(pivot, targetSegment.getA(), 180) : targetSegment.getB());
        }
        return new LineSegmentPair(first, second);
    }

    private static LineSegmentPair axiom5DetermineIndicators(
            FoldLineSet set,
            LineSegment base,
            LineSegment first,
            LineSegment second,
            Point pivot,
            Point center1,
            Point center2,
            Point target,
            LineSegment targetSegment) {
        if (OritaCalc.distance(center1, OritaCalc.findProjection(targetSegment, center1)) > Epsilon.UNKNOWN_1EN7
                || OritaCalc.distance(center2, OritaCalc.findProjection(targetSegment, center2)) > Epsilon.UNKNOWN_1EN7) {
            if (!OritaCalc.isPointWithinLineSpan(target, targetSegment)) {
                return new LineSegmentPair(
                        OritaCalc.fullExtendUntilHit(set, new LineSegment(pivot, center1, LineColor.PURPLE_8)),
                        OritaCalc.fullExtendUntilHit(set, new LineSegment(pivot, center2, LineColor.PURPLE_8)));
            }
            if (OritaCalc.isLineSegmentParallel(first, base) == OritaCalc.ParallelJudgement.PARALLEL_EQUAL) {
                LineSegment result = OritaCalc.fullExtendUntilHit(set, new LineSegment(pivot, center2, LineColor.PURPLE_8));
                return new LineSegmentPair(result, result);
            }
            if (OritaCalc.isLineSegmentParallel(second, base) == OritaCalc.ParallelJudgement.PARALLEL_EQUAL) {
                LineSegment result = OritaCalc.fullExtendUntilHit(set, new LineSegment(pivot, center1, LineColor.PURPLE_8));
                return new LineSegmentPair(result, result);
            }
            return null;
        }

        return new LineSegmentPair(
                OritaCalc.fullExtendUntilHit(set, new LineSegment(pivot,
                        OritaCalc.findProjection(OritaCalc.moveParallel(first, 1.0), pivot),
                        LineColor.PURPLE_8)),
                OritaCalc.fullExtendUntilHit(set, new LineSegment(pivot,
                        OritaCalc.findProjection(OritaCalc.moveParallel(second, -1.0), pivot),
                        LineColor.PURPLE_8)));
    }

    private static void foldLineAxiom7Indicator(String[] args) {
        if (args.length < 14) {
            usage("foldline-axiom7-indicator expects target point, target segment, perpendicular segment, count, and segment payload");
        }

        Point targetPoint = new Point(parse(args[1]), parse(args[2]));
        LineSegment targetSegment = segment(args, 3);
        LineSegment perpendicularSegment = segment(args, 8);
        int count = Integer.parseInt(args[13]);
        FoldLineSet set = foldLineSet(args, 14, count);
        LineSegment result = axiom7Indicator(set, targetPoint, targetSegment, perpendicularSegment);
        printSegmentResult(result);
    }

    private static void foldLineAxiom7Commit(String[] args) {
        if (args.length < 8) {
            usage("foldline-axiom7-commit expects indicator segment, color, count, and segment payload");
        }

        LineSegment indicator = segment(args, 1);
        LineColor color = LineColor.fromNumber(Integer.parseInt(args[6]));
        int count = Integer.parseInt(args[7]);
        FoldLineSet set = foldLineSet(args, 8, count);
        LineSegment result = indicator.withColor(color);
        boolean added = Epsilon.high.gt0(result.determineLength());
        if (added) {
            addLineSegmentLikeWorker(set, result);
        }

        System.out.println("added|" + added);
        printFoldLineSet(set);
    }

    private static void foldLineAxiom7Destination(String[] args) {
        if (args.length < 13) {
            usage("foldline-axiom7-destination expects indicator segment, destination segment, color, count, and segment payload");
        }

        LineSegment indicator = segment(args, 1);
        LineSegment destination = segment(args, 6);
        LineColor color = LineColor.fromNumber(Integer.parseInt(args[11]));
        int count = Integer.parseInt(args[12]);
        FoldLineSet set = foldLineSet(args, 13, count);
        LineSegment result = additionalIntersection(indicator, destination, color);
        boolean added = result != null;
        if (added) {
            addLineSegmentLikeWorker(set, result);
        }

        System.out.println("added|" + added);
        printFoldLineSet(set);
    }

    private static LineSegment axiom7Indicator(
            FoldLineSet set,
            Point targetPoint,
            LineSegment targetSegment,
            LineSegment perpendicularSegment) {
        LineSegment temp = new LineSegment(targetPoint, new Point(
                targetPoint.getX() + perpendicularSegment.determineBX() - perpendicularSegment.determineAX(),
                targetPoint.getY() + perpendicularSegment.determineBY() - perpendicularSegment.determineAY()));
        LineSegment extendLine = additionalIntersection(temp, targetSegment, LineColor.PURPLE_8);
        if (extendLine == null) {
            return null;
        }

        Point mid = OritaCalc.midPoint(targetPoint, OritaCalc.findIntersection(extendLine, targetSegment));
        LineSegment indicator = OritaCalc.fullExtendUntilHit(set, new LineSegment(mid,
                OritaCalc.findProjection(OritaCalc.moveParallel(extendLine, 1.0), mid), LineColor.PURPLE_8));
        return OritaCalc.fullExtendUntilHit(set, indicator.withCoordinates(indicator.getB(), indicator.getA()));
    }

    private static void foldLineSymmetricDraw(String[] args) {
        if (args.length < 13) {
            usage("foldline-symmetric-draw expects source segment, mirror segment, color, count, and segment payload");
        }

        LineSegment source = segment(args, 1);
        LineSegment mirror = segment(args, 6);
        LineColor color = LineColor.fromNumber(Integer.parseInt(args[11]));
        int count = Integer.parseInt(args[12]);
        FoldLineSet set = foldLineSet(args, 13, count);
        Point cross = OritaCalc.findIntersection(source, mirror);
        Point reflected = OritaCalc.findLineSymmetryPoint(
                cross,
                mirror.determineFurthestEndpoint(cross),
                source.determineFurthestEndpoint(cross));
        LineSegment addSegment = OritaCalc.extendToIntersectionPoint_2(
                set,
                new LineSegment(cross, reflected)).withColor(color);
        boolean added = Epsilon.high.gt0(addSegment.determineLength());
        if (added) {
            addLineSegmentLikeWorker(set, addSegment);
        }

        System.out.println("added|" + added);
        printFoldLineSet(set);
    }

    private static void foldLineDoubleSymmetricDraw(String[] args) {
        if (args.length < 7) {
            usage("foldline-double-symmetric-draw expects drag segment, count, and segment payload");
        }

        LineSegment dragSegment = segment(args, 1);
        int count = Integer.parseInt(args[6]);
        FoldLineSet set = foldLineSet(args, 7, count);

        int added = 0;
        if (Epsilon.high.gt0(dragSegment.determineLength())) {
            for (LineSegment segment : set.getLineSegmentsCollection()) {
                LineSegment.Intersection intersection = OritaCalc.determineLineSegmentIntersectionSweet(
                        segment,
                        dragSegment,
                        Epsilon.UNKNOWN_001,
                        Epsilon.UNKNOWN_001);

                if (!isDoubleSymmetricIntersection(intersection)) {
                    continue;
                }

                Point sourcePoint = segment.getA();
                if (OritaCalc.determineLineSegmentDistance(sourcePoint, dragSegment)
                        < OritaCalc.determineLineSegmentDistance(segment.getB(), dragSegment)) {
                    sourcePoint = segment.getB();
                }

                Point reflected = OritaCalc.findLineSymmetryPoint(
                        dragSegment.getA(),
                        dragSegment.getB(),
                        sourcePoint);
                LineSegment addSegment = OritaCalc.extendToIntersectionPoint_2(
                        set,
                        new LineSegment(OritaCalc.findIntersection(segment, dragSegment), reflected))
                        .withColor(segment.getColor());

                if (Epsilon.high.gt0(addSegment.determineLength())) {
                    addLineSegmentLikeWorker(set, addSegment);
                    added++;
                }
            }
        }

        System.out.println("added|" + added);
        printFoldLineSet(set);
    }

    private static boolean isDoubleSymmetricIntersection(LineSegment.Intersection intersection) {
        return switch (intersection) {
            case INTERSECTS_LSHAPE_S1_START_S2_START_21,
                 INTERSECTS_LSHAPE_S1_START_S2_END_22,
                 INTERSECTS_LSHAPE_S1_END_S2_START_23,
                 INTERSECTs_LSHAPE_S1_END_S2_END_24,
                 INTERSECTS_TSHAPE_S1_VERTICAL_BAR_25,
                 INTERSECTS_TSHAPE_S1_VERTICAL_BAR_26 -> true;
            default -> false;
        };
    }

    private static void foldLineContinuousSymmetricDraw(String[] args) {
        if (args.length < 7) {
            usage("foldline-continuous-symmetric-draw expects start point, through point, color, count, and segment payload");
        }

        Point start = new Point(parse(args[1]), parse(args[2]));
        Point through = new Point(parse(args[3]), parse(args[4]));
        LineColor color = LineColor.fromNumber(Integer.parseInt(args[5]));
        int count = Integer.parseInt(args[6]);
        FoldLineSet set = foldLineSet(args, 7, count);
        List<LineSegment> result = new ArrayList<>();
        continuousSymmetricSegments(set, start, through, null, result);

        int added = 0;
        LineColor lineColor = color;
        for (LineSegment segment : result) {
            LineSegment lineSegment = segment.withColor(lineColor);
            lineColor = lineColor.changeMV();
            if (Epsilon.high.gt0(lineSegment.determineLength())) {
                addLineSegmentLikeWorker(set, lineSegment);
                added++;
            }
        }

        System.out.println("added|" + added);
        printFoldLineSet(set);
    }

    private static void continuousSymmetricSegments(
            FoldLineSet set,
            Point a,
            Point b,
            Point start,
            List<LineSegment> result) {
        CreasePattern_Worker_Toolbox toolbox = new CreasePattern_Worker_Toolbox(set);
        toolbox.lengthenUntilIntersectionCalculateDisregardIncludedLineSegment_new(a, b);
        if (toolbox.getLengthenUntilIntersectionFlg_new() == StraightLine.Intersection.NONE_0) {
            return;
        }

        LineSegment segment = new LineSegment(toolbox.getLengthenUntilIntersectionLineSegment_new());
        result.add(segment);
        if (start != null && Epsilon.high.eq0(start.distance(segment.getB()))) {
            return;
        }
        if (toolbox.getLengthenUntilIntersectionFirstLineSegment_new().getColor() == LineColor.BLACK_0) {
            return;
        }
        if (start == null) {
            start = segment.getB();
        }

        if (toolbox.getLengthenUntilIntersectionFlg_new() == StraightLine.Intersection.INTERSECT_X_1) {
            continuousSymmetricReflect(set, a, start, result, toolbox);
            return;
        }

        if (toolbox.getLengthenUntilIntersectionFlg_new() == StraightLine.Intersection.INTERSECT_T_A_21
                || toolbox.getLengthenUntilIntersectionFlg_new() == StraightLine.Intersection.INTERSECT_T_B_22) {
            continuousSymmetricVertexSeed(set, a, b, start, result, toolbox);
        }
    }

    private static void continuousSymmetricReflect(
            FoldLineSet set,
            Point a,
            Point start,
            List<LineSegment> result,
            CreasePattern_Worker_Toolbox toolbox) {
        LineSegment hit = new LineSegment(toolbox.getLengthenUntilIntersectionFirstLineSegment_new());
        Point newA = toolbox.getLengthenUntilIntersectionPoint_new();
        Point newB = OritaCalc.findLineSymmetryPoint(hit.getA(), hit.getB(), a);
        continuousSymmetricSegments(set, newA, newB, start, result);
    }

    private static void continuousSymmetricVertexSeed(
            FoldLineSet set,
            Point a,
            Point b,
            Point start,
            List<LineSegment> result,
            CreasePattern_Worker_Toolbox toolbox) {
        StraightLine currentLine = new StraightLine(a, b);
        SortingBox<LineSegment> vertexLines = set.get_SortingBox_of_vertex_b_surrounding_foldLine(
                toolbox.getLengthenUntilIntersectionLineSegment_new().getA(),
                toolbox.getLengthenUntilIntersectionLineSegment_new().getB());

        if (vertexLines.getTotal() == 2) {
            if (currentLine.lineSegment_intersect_reverse_detail(vertexLines.getValue(1))
                    == StraightLine.Intersection.INCLUDED_3) {
                return;
            }
            if (currentLine.lineSegment_intersect_reverse_detail(vertexLines.getValue(2))
                    == StraightLine.Intersection.INCLUDED_3) {
                return;
            }
            StraightLine otherLine = new StraightLine(vertexLines.getValue(1));
            if (otherLine.lineSegment_intersect_reverse_detail(vertexLines.getValue(2))
                    == StraightLine.Intersection.INCLUDED_3) {
                continuousSymmetricReflect(set, a, start, result, toolbox);
            }
            return;
        }

        if (vertexLines.getTotal() == 3) {
            for (int includedIndex = 1; includedIndex <= 3; includedIndex++) {
                if (currentLine.lineSegment_intersect_reverse_detail(vertexLines.getValue(includedIndex))
                        != StraightLine.Intersection.INCLUDED_3) {
                    continue;
                }
                int nextIndex = includedIndex + 1;
                if (nextIndex > 3) {
                    nextIndex -= 3;
                }
                int lastIndex = includedIndex + 2;
                if (lastIndex > 3) {
                    lastIndex -= 3;
                }
                StraightLine otherLine = new StraightLine(vertexLines.getValue(nextIndex));
                if (otherLine.lineSegment_intersect_reverse_detail(vertexLines.getValue(lastIndex))
                        == StraightLine.Intersection.INCLUDED_3) {
                    continuousSymmetricReflect(set, a, start, result, toolbox);
                    return;
                }
            }
        }
    }

    private static void foldLineInward(String[] args) {
        if (args.length < 9) {
            usage("foldline-inward expects three points, color, count, and segment payload");
        }

        Point p1 = new Point(parse(args[1]), parse(args[2]));
        Point p2 = new Point(parse(args[3]), parse(args[4]));
        Point p3 = new Point(parse(args[5]), parse(args[6]));
        LineColor color = LineColor.fromNumber(Integer.parseInt(args[7]));
        int count = Integer.parseInt(args[8]);
        FoldLineSet set = foldLineSet(args, 9, count);

        Point center = OritaCalc.center(p1, p2, p3);
        int added = 0;
        for (Point point : List.of(p1, p2, p3)) {
            LineSegment addSegment = new LineSegment(point, center, color);
            if (Epsilon.high.gt0(addSegment.determineLength())) {
                addLineSegmentLikeWorker(set, addSegment);
                added++;
            }
        }

        System.out.println("added|" + added);
        printFoldLineSet(set);
    }

    private static void foldLineFishbone(String[] args) {
        if (args.length < 10) {
            usage("foldline-fishbone expects drag segment, grid width, color, selection distance, count, and segment payload");
        }

        LineSegment dragSegment = segment(args, 1);
        double gridWidth = parse(args[6]);
        LineColor color = LineColor.fromNumber(Integer.parseInt(args[7]));
        double selectionDistance = parse(args[8]);
        int count = Integer.parseInt(args[9]);
        FoldLineSet set = foldLineSet(args, 10, count);
        int added = 0;

        if (Epsilon.high.gt0(dragSegment.determineLength()) && gridWidth > 0.0) {
            double dx = (dragSegment.determineAX() - dragSegment.determineBX()) * gridWidth
                    / dragSegment.determineLength();
            double dy = (dragSegment.determineAY() - dragSegment.determineBY()) * gridWidth
                    / dragSegment.determineLength();
            LineColor currentColor = color;

            for (int i = 0; i <= (int) Math.floor(dragSegment.determineLength() / gridWidth); i++) {
                double px = dragSegment.determineBX() + (double) i * dx;
                double py = dragSegment.determineBY() + (double) i * dy;
                Point point = new Point(px, py);

                if (set.closestLineSegmentDistanceExcludingParallel(point, dragSegment) <= Epsilon.UNKNOWN_0001) {
                    continue;
                }

                int stationAdded = 0;
                LineSegment first = new LineSegment(px, py, px - dy, py + dx);
                if (fishboneHasForwardIntersection(set, first)) {
                    LineSegment result = OritaCalc.extendToIntersectionPoint_2(set, first).withColor(currentColor);
                    addLineSegmentLikeWorker(set, result);
                    stationAdded++;
                    added++;
                }

                LineSegment second = new LineSegment(px, py, px + dy, py - dx);
                if (fishboneHasForwardIntersection(set, second)) {
                    LineSegment result = OritaCalc.extendToIntersectionPoint_2(set, second).withColor(currentColor);
                    addLineSegmentLikeWorker(set, result);
                    stationAdded++;
                    added++;
                }

                if (stationAdded == 2) {
                    set.del_V(point, selectionDistance, Epsilon.UNKNOWN_1EN6);
                }

                currentColor = nextFishboneColor(currentColor);
            }
        }

        System.out.println("added|" + added);
        printFoldLineSet(set);
    }

    private static boolean fishboneHasForwardIntersection(FoldLineSet set, LineSegment seed) {
        StraightLine straightLine = new StraightLine(seed.getA(), seed.getB());
        for (LineSegment lineSegment : set.getLineSegmentsIterable()) {
            StraightLine.Intersection intersectionFlag = straightLine.lineSegment_intersect_reverse_detail(lineSegment);
            if (!intersectionFlag.isIntersecting()) {
                continue;
            }

            Point intersectionPoint = OritaCalc.findIntersection(straightLine, lineSegment);
            if (intersectionPoint.distance(seed.getA()) <= Epsilon.UNKNOWN_1EN5) {
                continue;
            }

            double angle = OritaCalc.angle(seed.getA(), seed.getB(), seed.getA(), intersectionPoint);
            if (angle < 1.0 || angle > 359.0) {
                return true;
            }
        }
        return false;
    }

    private static LineColor nextFishboneColor(LineColor color) {
        if (color == LineColor.RED_1) {
            return LineColor.BLUE_2;
        }
        if (color == LineColor.BLUE_2) {
            return LineColor.RED_1;
        }
        return color;
    }

    private static void foldLineAngleRestricted5(String[] args) {
        if (args.length < 15) {
            usage("foldline-angle-restricted5 expects anchor, pointer, divider, six angles, selection distance, color, count, and segment payload");
        }

        Point anchor = new Point(parse(args[1]), parse(args[2]));
        Point pointer = new Point(parse(args[3]), parse(args[4]));
        int divider = Integer.parseInt(args[5]);
        double[] angles = new double[] {
                parse(args[6]),
                parse(args[7]),
                parse(args[8]),
                parse(args[9]),
                parse(args[10]),
                parse(args[11]),
        };
        double selectionDistance = parse(args[12]);
        LineColor color = LineColor.fromNumber(Integer.parseInt(args[13]));
        int count = Integer.parseInt(args[14]);
        FoldLineSet set = foldLineSet(args, 15, count);

        Point release = snapToClosePointInActiveAngleSystem(set, anchor, pointer, divider, angles, selectionDistance);
        LineSegment result = new LineSegment(anchor, release, color);
        boolean added = Epsilon.high.gt0(result.determineLength());
        if (added) {
            addLineSegmentLikeWorker(set, result);
        }

        System.out.println("added|" + added);
        printFoldLineSet(set);
    }

    private static void foldLineAngleRestricted3Candidates(String[] args) {
        if (args.length != 12) {
            usage("foldline-angle-restricted3-candidates expects start, end, divider, and six angles");
        }

        Point start = new Point(parse(args[1]), parse(args[2]));
        Point end = new Point(parse(args[3]), parse(args[4]));
        int divider = Integer.parseInt(args[5]);
        double[] angles = new double[] {
                parse(args[6]),
                parse(args[7]),
                parse(args[8]),
                parse(args[9]),
                parse(args[10]),
                parse(args[11]),
        };
        printLineSegmentsList(angleRestricted3Candidates(start, end, divider, angles));
    }

    private static void foldLineAngleRestricted3Draw(String[] args) {
        if (args.length < 13) {
            usage("foldline-angle-restricted3-draw expects pointer, endpoint, selected candidate, selection distance, color, count, and segment payload");
        }

        Point pointer = new Point(parse(args[1]), parse(args[2]));
        Point endpoint = new Point(parse(args[3]), parse(args[4]));
        LineSegment selected = segment(args, 5);
        double selectionDistance = parse(args[10]);
        LineColor color = LineColor.fromNumber(Integer.parseInt(args[11]));
        int count = Integer.parseInt(args[12]);
        FoldLineSet set = foldLineSet(args, 13, count);
        boolean added = false;

        if (OritaCalc.determineLineSegmentDistance(pointer, selected) < selectionDistance) {
            Point targetPoint = OritaCalc.findProjection(selected, pointer);
            LineSegment closestLineSegment = new LineSegment(set.getClosestLineSegment(pointer));
            if (OritaCalc.determineLineSegmentDistance(pointer, closestLineSegment) < selectionDistance) {
                if (OritaCalc.isLineSegmentParallel(selected, closestLineSegment, Epsilon.UNKNOWN_1EN6)
                        == OritaCalc.ParallelJudgement.NOT_PARALLEL) {
                    Point intersection = OritaCalc.findIntersection(selected, closestLineSegment);
                    if (pointer.distance(targetPoint) * 2.0 > pointer.distance(intersection)) {
                        targetPoint = intersection;
                    }
                }
            }

            addLineSegmentLikeWorker(set, new LineSegment(targetPoint, endpoint, color));
            added = true;
        }

        System.out.println("added|" + added);
        printFoldLineSet(set);
    }

    private static void foldLineAngleRestrictedConvergingCandidates(String[] args) {
        if (args.length != 13) {
            usage("foldline-angle-restricted-converging-candidates expects segment, divider, and six angles");
        }

        LineSegment segment = segment(args, 1);
        int divider = Integer.parseInt(args[6]);
        double[] angles = new double[] {
                parse(args[7]),
                parse(args[8]),
                parse(args[9]),
                parse(args[10]),
                parse(args[11]),
                parse(args[12]),
        };
        AngleRestrictedConvergingCandidates candidates =
                angleRestrictedConvergingCandidates(segment, divider, angles);
        printLineSegmentsList(candidates.indicators);
        printPointsList(candidates.intersections);
    }

    private static void foldLineAngleRestrictedConvergingDraw(String[] args) {
        if (args.length < 10) {
            usage("foldline-angle-restricted-converging-draw expects base segment, converge point, color, count, and segment payload");
        }

        LineSegment segment = segment(args, 1);
        Point converge = new Point(parse(args[6]), parse(args[7]));
        LineColor color = LineColor.fromNumber(Integer.parseInt(args[8]));
        int count = Integer.parseInt(args[9]);
        FoldLineSet set = foldLineSet(args, 10, count);

        addLineSegmentLikeWorker(set, new LineSegment(segment.getA(), converge, color));
        addLineSegmentLikeWorker(set, new LineSegment(segment.getB(), converge, color));

        System.out.println("added|2");
        printFoldLineSet(set);
    }

    private static List<LineSegment> angleRestricted3Candidates(
            Point start,
            Point end,
            int divider,
            double[] angles) {
        List<LineSegment> candidates = new ArrayList<>();
        int count = divider != 0 ? divider * 2 - 1 : 6;
        LineSegment startingSegment = new LineSegment(end, start);

        if (divider != 0) {
            double angle = 0.0;
            double angleStep = 180.0 / (double) divider;
            for (int i = 0; i < count; i++) {
                angle += angleStep;
                LineSegment candidate = OritaCalc.lineSegment_rotate(startingSegment, angle, 100.0);
                if (i % 2 == 0) {
                    candidate = candidate.withColor(LineColor.ORANGE_4);
                } else {
                    candidate = candidate.withColor(LineColor.GREEN_6);
                }
                candidates.add(candidate);
            }
        } else {
            LineColor[] colors = new LineColor[] {
                    LineColor.ORANGE_4,
                    LineColor.GREEN_6,
                    LineColor.PURPLE_8
            };
            for (int i = 0; i < 6; i++) {
                candidates.add(OritaCalc.lineSegment_rotate(startingSegment, angles[i], 100.0).withColor(colors[i % 3]));
            }
        }
        return candidates;
    }

    private static AngleRestrictedConvergingCandidates angleRestrictedConvergingCandidates(
            LineSegment segment,
            int divider,
            double[] angles) {
        List<LineSegment> indicators = new ArrayList<>();
        int count = divider != 0 ? divider * 2 - 1 : 6;

        if (divider != 0) {
            double angleStep = 180.0 / (double) divider;
            addAngleRestrictedConvergingDividerIndicators(indicators, segment, angleStep, count);
            addAngleRestrictedConvergingDividerIndicators(indicators, segment.withSwappedCoordinates(), angleStep, count);
        } else {
            addAngleRestrictedConvergingCustomIndicators(indicators, segment, angles);
            addAngleRestrictedConvergingCustomIndicators(indicators, segment.withSwappedCoordinates(), angles);
        }

        return new AngleRestrictedConvergingCandidates(
                indicators,
                angleRestrictedConvergingIntersections(segment, indicators));
    }

    private static void addAngleRestrictedConvergingDividerIndicators(
            List<LineSegment> indicators,
            LineSegment segment,
            double angleStep,
            int count) {
        double angle = 0.0;
        for (int i = 0; i < count; i++) {
            angle += angleStep;
            LineSegment indicator = OritaCalc.lineSegment_rotate(segment, angle, 10.0);
            if (i % 2 == 0) {
                indicator = indicator.withColor(LineColor.ORANGE_4);
            } else {
                indicator = indicator.withColor(LineColor.GREEN_6);
            }
            indicators.add(indicator);
        }
    }

    private static void addAngleRestrictedConvergingCustomIndicators(
            List<LineSegment> indicators,
            LineSegment segment,
            double[] angles) {
        LineColor[] colors = new LineColor[] {
                LineColor.GREEN_6,
                LineColor.PURPLE_8,
                LineColor.ORANGE_4,
                LineColor.ORANGE_4,
                LineColor.GREEN_6,
                LineColor.PURPLE_8,
        };
        for (int i = 0; i < 6; i++) {
            indicators.add(OritaCalc.lineSegment_rotate(segment, angles[i], 10.0).withColor(colors[i]));
        }
    }

    private static List<Point> angleRestrictedConvergingIntersections(
            LineSegment segment,
            List<LineSegment> indicators) {
        List<Point> intersections = new ArrayList<>();
        for (int i = 0; i < indicators.size(); i++) {
            for (int j = i + 1; j < indicators.size(); j++) {
                LineSegment first = indicators.get(i);
                LineSegment second = indicators.get(j);
                LineSegment.Intersection intersection =
                        OritaCalc.determineLineSegmentIntersection(first, second);
                if (!intersection.isIntersection() || intersection.isOverlapping()) {
                    continue;
                }

                Point point = OritaCalc.findIntersection(first, second);
                if (point.equals(segment.getA()) || point.equals(segment.getB())) {
                    continue;
                }
                if (intersections.stream().anyMatch(existing -> existing.equals(point))) {
                    continue;
                }
                intersections.add(point);
            }
        }
        return intersections;
    }

    private static Point snapToActiveAngleSystem(
            FoldLineSet set,
            Point start,
            Point point,
            int angleSystemDivider,
            double[] angles,
            double selectionDistance) {
        double radians;
        LineSegment base = new LineSegment(point, start);
        if (angleSystemDivider != 0) {
            double angleStep = 180.0 / (double) angleSystemDivider;
            radians = (Math.PI / 180.0) * angleStep * (int) Math.round(OritaCalc.angle(base) / angleStep);
        } else {
            double currentAngle = OritaCalc.angle(base);
            double minDifference = 1000.0;
            double chosenAngle = 0.0;
            for (int i = 0; i < 6; i++) {
                double candidate = angles[i] - 180.0;
                double difference = Math.min(
                        OritaCalc.angle_between_0_360(candidate - currentAngle),
                        OritaCalc.angle_between_0_360(currentAngle - candidate));
                if (difference < minDifference) {
                    minDifference = difference;
                    chosenAngle = candidate;
                }
            }
            radians = (Math.PI / 180.0) * chosenAngle;
        }

        LineSegment closestSegment = set.getClosestLineSegment(point);
        LineSegment snapLine = new LineSegment(
                base.getB(),
                new Point(base.determineBX() + Math.cos(radians), base.determineBY() + Math.sin(radians)));
        Point result = OritaCalc.findProjection(snapLine, point);
        if (OritaCalc.determineLineSegmentDistance(point, closestSegment) <= selectionDistance) {
            if (OritaCalc.isLineSegmentParallel(closestSegment, snapLine, Epsilon.PARALLEL_FOR_FIX)
                    == OritaCalc.ParallelJudgement.NOT_PARALLEL) {
                result = OritaCalc.findIntersection(closestSegment, snapLine);
            }
        }
        return result;
    }

    private static Point snapToClosePointInActiveAngleSystem(
            FoldLineSet set,
            Point start,
            Point point,
            int angleSystemDivider,
            double[] angles,
            double selectionDistance) {
        Point snapped = snapToActiveAngleSystem(set, start, point, angleSystemDivider, angles, selectionDistance);
        Point closestPoint = set.closestPoint(snapped);
        double offsetAngle = OritaCalc.angle(start, snapped, start, closestPoint);
        boolean offset = (Epsilon.UNKNOWN_1EN5 < offsetAngle) && (offsetAngle <= 360.0 - Epsilon.UNKNOWN_1EN5);
        if (offset || snapped.distance(closestPoint) > selectionDistance) {
            return snapped;
        }
        return closestPoint;
    }

    private static void foldLineAngleSystemCandidates(String[] args) {
        if (args.length != 12) {
            usage("foldline-angle-system-candidates expects start, end, divider, and six angles");
        }

        Point start = new Point(parse(args[1]), parse(args[2]));
        Point end = new Point(parse(args[3]), parse(args[4]));
        int divider = Integer.parseInt(args[5]);
        double[] angles = new double[] {
                parse(args[6]),
                parse(args[7]),
                parse(args[8]),
                parse(args[9]),
                parse(args[10]),
                parse(args[11]),
        };
        printLineSegmentsList(angleSystemCandidates(start, end, divider, angles));
    }

    private static void foldLineAngleSystemDraw(String[] args) {
        if (args.length < 15) {
            usage("foldline-angle-system-draw expects release point, selected segment, destination segment, color, count, and segment payload");
        }

        Point release = new Point(parse(args[1]), parse(args[2]));
        LineSegment selected = segment(args, 3);
        LineSegment destination = segment(args, 8);
        LineColor color = LineColor.fromNumber(Integer.parseInt(args[13]));
        int count = Integer.parseInt(args[14]);
        FoldLineSet set = foldLineSet(args, 15, count);

        LineSegment result = new LineSegment(OritaCalc.findIntersection(destination, selected), release, color);
        boolean added = Epsilon.high.gt0(result.determineLength());
        if (added) {
            addLineSegmentLikeWorker(set, result);
        }

        System.out.println("added|" + added);
        printFoldLineSet(set);
    }

    private static List<LineSegment> angleSystemCandidates(Point start, Point end, int divider, double[] angles) {
        List<LineSegment> candidates = new ArrayList<>();
        int count = divider != 0 ? divider * 2 - 1 : 6;
        LineSegment startingSegment = new LineSegment(end, start, LineColor.GREEN_6);
        candidates.add(startingSegment);

        if (divider != 0) {
            double angle = 0.0;
            double angleStep = 180.0 / (double) divider;
            for (int i = 0; i < count; i++) {
                angle += angleStep;
                LineSegment segment = OritaCalc.lineSegment_rotate(startingSegment, angle, 1.0);
                if (i % 2 == 0) {
                    segment = segment.withColor(LineColor.ORANGE_4);
                } else {
                    segment = segment.withColor(LineColor.GREEN_6);
                }
                candidates.add(segment);
            }
        } else {
            LineColor[] colors = new LineColor[] {
                    LineColor.ORANGE_4,
                    LineColor.GREEN_6,
                    LineColor.PURPLE_8
            };
            for (int i = 0; i < 6; i++) {
                candidates.add(OritaCalc.lineSegment_rotate(startingSegment, angles[i], 1.0).withColor(colors[i % 3]));
            }
        }
        return candidates;
    }

    private static void foldLineMakeVertexFlatFoldableCandidates(String[] args) {
        if (args.length < 6) {
            usage("foldline-make-vertex-flat-foldable-candidates expects vertex, grid width, color, count, and segment payload");
        }

        Point vertex = new Point(parse(args[1]), parse(args[2]));
        double gridWidth = parse(args[3]);
        LineColor color = LineColor.fromNumber(Integer.parseInt(args[4]));
        int count = Integer.parseInt(args[5]);
        FoldLineSet set = foldLineSet(args, 6, count);
        SortingBox<LineSegment> nbox = vertexSortingBox(set, vertex);
        LineColor commitColor = nbox.getTotal() == 1 ? nbox.getValue(1).getColor() : color;
        System.out.println("color|" + commitColor.getNumber());
        printLineSegmentsList(oddVertexFoldableCandidates(nbox, vertex, gridWidth, LineSegment.ActiveState.INACTIVE_0));
    }

    private static void foldLineMakeVertexFlatFoldableDestination(String[] args) {
        if (args.length < 15) {
            usage("foldline-make-vertex-flat-foldable-destination expects vertex, candidate, destination, color, count, and segment payload");
        }

        Point vertex = new Point(parse(args[1]), parse(args[2]));
        LineSegment candidate = segment(args, 3);
        LineSegment destination = segment(args, 8);
        LineColor color = LineColor.fromNumber(Integer.parseInt(args[13]));
        int count = Integer.parseInt(args[14]);
        FoldLineSet set = foldLineSet(args, 15, count);
        Point crossPoint = OritaCalc.findIntersection(candidate, destination);
        LineSegment result = new LineSegment(crossPoint, vertex, color);
        boolean added = Epsilon.high.gt0(result.determineLength());
        if (added) {
            addLineSegmentLikeWorker(set, result);
        }

        System.out.println("added|" + added);
        printFoldLineSet(set);
    }

    private static void foldLineFoldableInputCandidates(String[] args) {
        if (args.length < 5) {
            usage("foldline-foldable-input-candidates expects vertex, grid width, count, and segment payload");
        }

        Point vertex = new Point(parse(args[1]), parse(args[2]));
        double gridWidth = parse(args[3]);
        int count = Integer.parseInt(args[4]);
        FoldLineSet set = foldLineSet(args, 5, count);
        printLineSegmentsList(oddVertexFoldableCandidates(
                vertexSortingBox(set, vertex),
                vertex,
                gridWidth,
                LineSegment.ActiveState.ACTIVE_A_1));
    }

    private static void foldLineFoldableInputDirect(String[] args) {
        if (args.length < 8) {
            usage("foldline-foldable-input-direct expects input segment, color, count, and segment payload");
        }

        LineSegment input = segment(args, 1);
        LineColor color = LineColor.fromNumber(Integer.parseInt(args[6]));
        int count = Integer.parseInt(args[7]);
        FoldLineSet set = foldLineSet(args, 8, count);
        LineSegment result = new LineSegment(input.getA(), input.getB(), color);
        boolean added = Epsilon.high.gt0(result.determineLength());
        if (added) {
            addLineSegmentLikeWorker(set, result);
        }

        System.out.println("added|" + added);
        printFoldLineSet(set);
    }

    private static void foldLineFoldableInputDestination(String[] args) {
        if (args.length < 13) {
            usage("foldline-foldable-input-destination expects input segment, destination segment, color, count, and segment payload");
        }

        LineSegment input = segment(args, 1);
        LineSegment destination = segment(args, 6);
        LineColor color = LineColor.fromNumber(Integer.parseInt(args[11]));
        int count = Integer.parseInt(args[12]);
        FoldLineSet set = foldLineSet(args, 13, count);
        LineSegment result = new LineSegment(OritaCalc.findIntersection(input, destination), input.getA(), color);
        boolean added = Epsilon.high.gt0(result.determineLength());
        if (added) {
            addLineSegmentLikeWorker(set, result);
        }

        System.out.println("added|" + added);
        printFoldLineSet(set);
    }

    private static void foldLineFoldableDrawMode(String[] args) {
        if (args.length < 5) {
            usage("foldline-foldable-draw-mode expects pointer, selection distance, count, and segment payload");
        }

        Point pointer = new Point(parse(args[1]), parse(args[2]));
        double selectionDistance = parse(args[3]);
        int count = Integer.parseInt(args[4]);
        FoldLineSet set = foldLineSet(args, 5, count);
        Point closestPoint = set.closestPoint(pointer);
        Point resolvedPoint = pointer.distance(closestPoint) > selectionDistance ? pointer : closestPoint;
        String mode = vertexSortingBox(set, resolvedPoint).getTotal() % 2 == 0 ? "free" : "flat";
        System.out.println("mode|" + mode);
    }

    private static void foldLineFoldableDrawSwitch(String[] args) {
        if (args.length != 6) {
            usage("foldline-foldable-draw-switch expects pointer, memo point, and selection distance");
        }

        Point pointer = new Point(parse(args[1]), parse(args[2]));
        Point memo = new Point(parse(args[3]), parse(args[4]));
        double selectionDistance = parse(args[5]);
        System.out.println("switch|" + (pointer.distance(memo) > selectionDistance));
    }

    private static SortingBox<LineSegment> vertexSortingBox(FoldLineSet set, Point vertex) {
        SortingBox<LineSegment> nbox = new SortingBox<>();
        for (LineSegment segment : set.getLineSegmentsIterable()) {
            if (segment.getColor().isFoldingLine()) {
                if (vertex.distance(segment.getA()) < Epsilon.UNKNOWN_1EN6) {
                    nbox.addByWeight(segment, OritaCalc.angle(segment.getA(), segment.getB()));
                } else if (vertex.distance(segment.getB()) < Epsilon.UNKNOWN_1EN6) {
                    nbox.addByWeight(segment, OritaCalc.angle(segment.getB(), segment.getA()));
                }
            }
        }
        return nbox;
    }

    private static List<LineSegment> oddVertexFoldableCandidates(
            SortingBox<LineSegment> nbox,
            Point vertex,
            double gridWidth,
            LineSegment.ActiveState activeState) {
        List<LineSegment> candidates = new ArrayList<>();
        if (nbox.getTotal() % 2 != 1) {
            return candidates;
        }

        for (int i = 1; i <= nbox.getTotal(); i++) {
            double angleDelta = 0.0;
            int near;
            int far;
            for (int k = 1; k <= nbox.getTotal(); k++) {
                near = i + k - 1;
                if (near > nbox.getTotal()) {
                    near = near - nbox.getTotal();
                }
                far = i + k;
                if (far > nbox.getTotal()) {
                    far = far - nbox.getTotal();
                }

                double addAngle = OritaCalc.angle_between_0_360(nbox.getWeight(far) - nbox.getWeight(near));
                if (k % 2 == 1) {
                    angleDelta = angleDelta + addAngle;
                } else {
                    angleDelta = angleDelta - addAngle;
                }
            }

            if (nbox.getTotal() == 1) {
                angleDelta = 360.0;
            }

            near = i;
            if (near > nbox.getTotal()) {
                near = near - nbox.getTotal();
            }
            far = i + 1;
            if (far > nbox.getTotal()) {
                far = far - nbox.getTotal();
            }

            double firstWedgeAngle = OritaCalc.angle_between_0_360(nbox.getWeight(far) - nbox.getWeight(near));
            if (nbox.getTotal() == 1) {
                firstWedgeAngle = 360.0;
            }

            if ((angleDelta / 2.0 > Epsilon.UNKNOWN_1EN6)
                    && (angleDelta / 2.0 < firstWedgeAngle - Epsilon.UNKNOWN_1EN6)) {
                LineSegment base = new LineSegment();
                LineSegment nboxLineSegment = nbox.getValue(i);
                if (vertex.distance(nboxLineSegment.getA()) < Epsilon.UNKNOWN_1EN6) {
                    base = new LineSegment(nboxLineSegment.getA(), nboxLineSegment.getB());
                } else if (vertex.distance(nboxLineSegment.getB()) < Epsilon.UNKNOWN_1EN6) {
                    base = new LineSegment(nboxLineSegment.getB(), nboxLineSegment.getA());
                }

                double baseLength = base.determineLength();
                LineSegment candidate = OritaCalc.lineSegment_rotate(
                        base,
                        angleDelta / 2.0,
                        gridWidth / baseLength).withColor(LineColor.PURPLE_8);
                candidate = candidate.withActive(activeState);
                candidates.add(candidate);
            }
        }
        return candidates;
    }

    private static void foldLineSquareBisector3p(String[] args) {
        if (args.length < 14) {
            usage("foldline-square-bisector-3p expects three points, destination segment, color, count, and segment payload");
        }

        Point p1 = new Point(parse(args[1]), parse(args[2]));
        Point p2 = new Point(parse(args[3]), parse(args[4]));
        Point p3 = new Point(parse(args[5]), parse(args[6]));
        LineSegment destination = segment(args, 7);
        LineColor color = LineColor.fromNumber(Integer.parseInt(args[12]));
        int count = Integer.parseInt(args[13]);
        FoldLineSet set = foldLineSet(args, 14, count);
        boolean added = false;

        if (!OritaCalc.isPointWithinLineSpan(p1, p2, p3)) {
            Point incenter = OritaCalc.center(p1, p2, p3);
            LineSegment seed = new LineSegment(p2, incenter);
            if (OritaCalc.isLineSegmentParallel(seed, destination) == OritaCalc.ParallelJudgement.NOT_PARALLEL) {
                LineSegment result = new LineSegment(OritaCalc.findIntersection(seed, destination), p2, color);
                added = addSquareBisectorLine(set, result);
            }
        }

        System.out.println("added|" + added);
        printFoldLineSet(set);
    }

    private static void foldLineSquareBisector2lNp(String[] args) {
        if (args.length < 18) {
            usage("foldline-square-bisector-2l-np expects two source segments, destination segment, color, count, and segment payload");
        }

        LineSegment first = segment(args, 1);
        LineSegment second = segment(args, 6);
        LineSegment destination = segment(args, 11);
        LineColor color = LineColor.fromNumber(Integer.parseInt(args[16]));
        int count = Integer.parseInt(args[17]);
        FoldLineSet set = foldLineSet(args, 18, count);

        Point intersection = OritaCalc.findIntersection(first, second);
        Point incenter = OritaCalc.center(
                intersection,
                first.determineFurthestEndpoint(intersection),
                second.determineFurthestEndpoint(intersection));
        LineSegment tempBisect = OritaCalc.fullExtendUntilHit(set, new LineSegment(intersection, incenter));
        boolean added = false;
        if (OritaCalc.isLineSegmentParallel(tempBisect, destination) == OritaCalc.ParallelJudgement.NOT_PARALLEL) {
            LineSegment result = new LineSegment(OritaCalc.findIntersection(tempBisect, destination), intersection, color);
            added = addSquareBisectorLine(set, result);
        }

        System.out.println("added|" + added);
        printFoldLineSet(set);
    }

    private static void foldLineSquareBisectorParallelIndicator(String[] args) {
        if (args.length < 12) {
            usage("foldline-square-bisector-parallel-indicator expects two source segments, count, and segment payload");
        }

        LineSegment first = segment(args, 1);
        LineSegment second = segment(args, 6);
        int count = Integer.parseInt(args[11]);
        FoldLineSet set = foldLineSet(args, 12, count);
        LineSegment result = squareBisectorParallelIndicator(set, first, second);
        printSegmentResult(result);
    }

    private static void foldLineSquareBisectorParallelCommit(String[] args) {
        if (args.length < 8) {
            usage("foldline-square-bisector-parallel-commit expects indicator segment, color, count, and segment payload");
        }

        LineSegment indicator = segment(args, 1);
        LineColor color = LineColor.fromNumber(Integer.parseInt(args[6]));
        int count = Integer.parseInt(args[7]);
        FoldLineSet set = foldLineSet(args, 8, count);
        boolean added = addSquareBisectorLine(set, indicator.withColor(color));

        System.out.println("added|" + added);
        printFoldLineSet(set);
    }

    private static void foldLineSquareBisectorParallelBetween(String[] args) {
        if (args.length < 18) {
            usage("foldline-square-bisector-parallel-between expects indicator, two destination segments, color, count, and segment payload");
        }

        LineSegment indicator = segment(args, 1);
        LineSegment firstDestination = segment(args, 6);
        LineSegment secondDestination = segment(args, 11);
        LineColor color = LineColor.fromNumber(Integer.parseInt(args[16]));
        int count = Integer.parseInt(args[17]);
        FoldLineSet set = foldLineSet(args, 18, count);
        boolean added = false;

        if (OritaCalc.isLineSegmentParallel(firstDestination, secondDestination) != OritaCalc.ParallelJudgement.PARALLEL_EQUAL) {
            LineSegment result = new LineSegment(
                    OritaCalc.findIntersection(indicator, firstDestination),
                    OritaCalc.findIntersection(indicator, secondDestination),
                    color);
            added = addSquareBisectorLine(set, result);
        }

        System.out.println("added|" + added);
        printFoldLineSet(set);
    }

    private static LineSegment squareBisectorParallelIndicator(FoldLineSet set, LineSegment first, LineSegment second) {
        if (OritaCalc.isLineSegmentParallel(first, second, Epsilon.UNKNOWN_1EN4) == OritaCalc.ParallelJudgement.NOT_PARALLEL) {
            return null;
        }

        Point projectedPoint = OritaCalc.findProjection(first, second.getA());
        Point midPoint = OritaCalc.midPoint(second.getA(), projectedPoint);
        LineSegment tempPerpenLine = new LineSegment(second.getA(), projectedPoint);
        LineSegment indicator = OritaCalc.fullExtendUntilHit(
                set,
                new LineSegment(
                        midPoint,
                        OritaCalc.findProjection(OritaCalc.moveParallel(tempPerpenLine, -1.0), midPoint),
                        LineColor.PURPLE_8));
        return OritaCalc.fullExtendUntilHit(set, indicator.withCoordinates(indicator.getB(), indicator.getA()));
    }

    private static boolean addSquareBisectorLine(FoldLineSet set, LineSegment segment) {
        if (!Epsilon.high.gt0(segment.determineLength())) {
            return false;
        }
        addLineSegmentLikeWorker(set, segment);
        return true;
    }

    private static void foldLineDrawCrease(String[] args) {
        if (args.length < 8) {
            usage("foldline-draw-crease expects target, segment, count, and segment payload");
        }

        String target = args[1];
        LineSegment segment = new LineSegment(
                new Point(parse(args[2]), parse(args[3])),
                new Point(parse(args[4]), parse(args[5])),
                LineColor.fromNumber(Integer.parseInt(args[6])));
        int count = Integer.parseInt(args[7]);
        FoldLineSet set = foldLineSet(args, 8, count);
        FoldLineSet aux = new FoldLineSet();
        boolean changed = false;
        if (Epsilon.high.gt0(segment.determineLength())) {
            switch (target) {
                case "fold" -> addLineSegmentLikeWorker(set, segment);
                case "aux" -> aux.addLine(segment);
                default -> usage("unknown draw-crease target: " + target);
            }
            changed = true;
        }

        System.out.println("changed|" + changed);
        printFoldLineSet(set);
        printAuxLineSet(aux);
    }

    private static void foldLineDrawSymmetric(String[] args) {
        if (args.length < 8) {
            usage("foldline-draw-symmetric expects axis segment, preselected indices, count, and segment payload");
        }

        LineSegment axis = new LineSegment(
                new Point(parse(args[1]), parse(args[2])),
                new Point(parse(args[3]), parse(args[4])),
                LineColor.fromNumber(Integer.parseInt(args[5])));
        int count = Integer.parseInt(args[7]);
        FoldLineSet set = foldLineSet(args, 8, count);
        applySelectedIndices(set, args[6], 2);

        int oldTotal = set.getTotal();
        int mirrored = 0;
        for (LineSegment line : set.getLineSegmentsCollection()) {
            if (line.getSelected() == 2) {
                LineSegment add = OritaCalc
                        .findLineSymmetryLineSegment(line, axis)
                        .withColor(line.getColor());
                set.addLine(add);
                mirrored++;
            }
        }
        int newTotal = set.getTotal();
        set.divideLineSegmentWithNewLines(oldTotal, newTotal);
        set.unselect_all();

        System.out.println("mirrored|" + mirrored);
        printFoldLineSetWithSelection(set);
    }

    private static void foldLineDrawPoint(String[] args) {
        if (args.length < 6) {
            usage("foldline-draw-point expects index, target point, selection distance, count, and segment payload");
        }

        int index = Integer.parseInt(args[1]);
        Point target = new Point(parse(args[2]), parse(args[3]));
        double selectionDistance = parse(args[4]);
        int count = Integer.parseInt(args[5]);
        FoldLineSet set = foldLineSet(args, 6, count);
        boolean changed = false;
        if (index >= 0 && index < set.getTotal()) {
            LineSegment segment = new LineSegment(set.get(index + 1));
            if (OritaCalc.determineLineSegmentDistance(target, segment) <= selectionDistance) {
                Point projection = OritaCalc.findProjection(OritaCalc.lineSegmentToStraightLine(segment), target);
                if (OritaCalc.isInside(segment.getA(), projection, segment.getB()) == 2) {
                    set.applyLineSegmentDivide(segment, projection);
                    changed = true;
                }
            }
        }

        System.out.println("changed|" + changed);
        printFoldLineSet(set);
    }

    private static void foldLineCircleDraw(String[] args) {
        if (args.length != 5) {
            usage("foldline-circle-draw expects center and radius point");
        }

        Point center = new Point(parse(args[1]), parse(args[2]));
        Point radiusPoint = new Point(parse(args[3]), parse(args[4]));
        FoldLineSet set = new FoldLineSet();
        set.addCircle(center.getX(), center.getY(), OritaCalc.distance(center, radiusPoint), LineColor.CYAN_3);
        System.out.println("changed|true");
        printCircleSet(set);
    }

    private static void foldLineCircleDrawFree(String[] args) {
        if (args.length != 5) {
            usage("foldline-circle-draw-free expects center and radius point");
        }

        Point center = new Point(parse(args[1]), parse(args[2]));
        Point radiusPoint = new Point(parse(args[3]), parse(args[4]));
        FoldLineSet set = new FoldLineSet();
        boolean changed = false;
        if (!center.equals(radiusPoint)) {
            set.addCircle(center.getX(), center.getY(), OritaCalc.distance(center, radiusPoint), LineColor.CYAN_3);
            changed = true;
        }
        System.out.println("changed|" + changed);
        printCircleSet(set);
    }

    private static void foldLineCircleThreePoint(String[] args) {
        if (args.length != 7) {
            usage("foldline-circle-three-point expects three points");
        }

        Point p1 = new Point(parse(args[1]), parse(args[2]));
        Point p2 = new Point(parse(args[3]), parse(args[4]));
        Point p3 = new Point(parse(args[5]), parse(args[6]));
        FoldLineSet set = new FoldLineSet();
        boolean changed = false;

        LineSegment sen1 = new LineSegment(p1, p2);
        LineSegment sen2 = new LineSegment(p2, p3);
        LineSegment sen3 = new LineSegment(p3, p1);

        if (!isFlatAngle(OritaCalc.angle(sen1, sen2))
                && !isFlatAngle(OritaCalc.angle(sen2, sen3))
                && !isFlatAngle(OritaCalc.angle(sen3, sen1))) {
            StraightLine t1 = new StraightLine(sen1)
                    .orthogonalize(OritaCalc.internalDivisionRatio(sen1.getA(), sen1.getB(), 1.0, 1.0));
            StraightLine t2 = new StraightLine(sen2)
                    .orthogonalize(OritaCalc.internalDivisionRatio(sen2.getA(), sen2.getB(), 1.0, 1.0));
            Point center = OritaCalc.findIntersection(t1, t2);
            set.addCircle(center.getX(), center.getY(), OritaCalc.distance(p1, center), LineColor.CYAN_3);
            changed = true;
        }

        System.out.println("changed|" + changed);
        printCircleSet(set);
    }

    private static boolean isFlatAngle(double angle) {
        return Math.abs(angle) < Epsilon.UNKNOWN_1EN6
                || Math.abs(angle - 180.0) < Epsilon.UNKNOWN_1EN6
                || Math.abs(angle - 360.0) < Epsilon.UNKNOWN_1EN6;
    }

    private static void foldLineCircleSeparate(String[] args) {
        if (args.length != 7) {
            usage("foldline-circle-separate expects center and radius segment endpoints");
        }

        Point center = new Point(parse(args[1]), parse(args[2]));
        Point a = new Point(parse(args[3]), parse(args[4]));
        Point b = new Point(parse(args[5]), parse(args[6]));
        FoldLineSet set = new FoldLineSet();
        set.addCircle(center.getX(), center.getY(), OritaCalc.distance(a, b), LineColor.CYAN_3);
        System.out.println("changed|true");
        printCircleSet(set);
    }

    private static void foldLineCircleConcentric(String[] args) {
        if (args.length != 9) {
            usage("foldline-circle-concentric expects circle and radius segment endpoints");
        }

        Circle original = circle(args, 1);
        Point a = new Point(parse(args[5]), parse(args[6]));
        Point b = new Point(parse(args[7]), parse(args[8]));
        FoldLineSet set = new FoldLineSet();
        set.addCircle(
                original.getX(),
                original.getY(),
                original.getR() + OritaCalc.distance(a, b),
                LineColor.CYAN_3);
        System.out.println("changed|true");
        printCircleSet(set);
    }

    private static void foldLineCircleConcentricSelect(String[] args) {
        if (args.length != 14) {
            usage("foldline-circle-concentric-select expects candidate index, target circle, and two reference circles");
        }

        int candidateIndex = Integer.parseInt(args[1]);
        Circle target = circle(args, 2);
        Circle reference1 = circle(args, 6);
        Circle reference2 = circle(args, 10);
        List<Circle> candidates = concentricSelectCandidates(target, reference1, reference2);
        FoldLineSet set = new FoldLineSet();
        boolean changed = false;
        if (candidateIndex >= 0 && candidateIndex < candidates.size()) {
            Circle selected = new Circle(candidates.get(candidateIndex));
            selected.setColor(LineColor.CYAN_3);
            set.getCircles().add(selected);
            changed = true;
        }
        System.out.println("changed|" + changed);
        printCircleSet(set);
    }

    private static List<Circle> concentricSelectCandidates(Circle target, Circle reference1, Circle reference2) {
        List<Circle> candidates = new ArrayList<>();
        double deltaR = Math.abs(reference2.getR() - reference1.getR());
        if (Epsilon.high.eq0(deltaR)) {
            return candidates;
        }

        double outerR = target.getR() + deltaR;
        double innerR = target.getR() - deltaR;
        candidates.add(new Circle(target.determineCenter(), outerR, LineColor.MAGENTA_5));
        if (Epsilon.high.gt0(innerR)) {
            candidates.add(new Circle(target.determineCenter(), innerR, LineColor.MAGENTA_5));
        }
        return candidates;
    }

    private static void foldLineCircleConcentricTwo(String[] args) {
        if (args.length != 9) {
            usage("foldline-circle-concentric-two expects two circles");
        }

        Circle circle1 = circle(args, 1);
        Circle circle2 = circle(args, 5);
        FoldLineSet set = new FoldLineSet();
        int added = 0;
        if (OritaCalc.circle_to_circle_intersection(circle1, circle2) != Circle.Intersection.TANGENT) {
            double centerLineLength = OritaCalc.distance(circle1.determineCenter(), circle2.determineCenter());
            double concentricOffset = (centerLineLength - circle1.getR() - circle2.getR()) / 2.0;
            set.addCircle(circle1.getX(), circle1.getY(), circle1.getR() + concentricOffset, LineColor.CYAN_3);
            set.addCircle(circle2.getX(), circle2.getY(), circle2.getR() + concentricOffset, LineColor.CYAN_3);
            added = 2;
        }
        System.out.println("added|" + added);
        printCircleSet(set);
    }

    private static void foldLineCircleInvertCircle(String[] args) {
        if (args.length != 9) {
            usage("foldline-circle-invert-circle expects subject circle and inversion circle");
        }

        Circle subject = circle(args, 1);
        Circle inversion = circle(args, 5);
        FoldLineSet set = new FoldLineSet();
        String outcome = invertCircle(set, subject, inversion);
        System.out.println("outcome|" + outcome);
        printFoldLineSet(set);
        printCircleSet(set);
    }

    private static String invertCircle(FoldLineSet set, Circle subject, Circle inversion) {
        if (Math.abs(OritaCalc.distance(subject.determineCenter(), inversion.determineCenter())
                - subject.getR()) < Epsilon.UNKNOWN_1EN7) {
            set.addLine(inversion.turnAround_CircleToLineSegment(subject));
            return "line";
        }

        Circle added = new Circle();
        added.set(inversion.turnAround(subject));
        added.setColor(LineColor.CYAN_3);
        set.getCircles().add(added);
        return "circle";
    }

    private static void foldLineCircleInvertLine(String[] args) {
        if (args.length != 10) {
            usage("foldline-circle-invert-line expects line segment and inversion circle");
        }

        LineSegment subject = segment(args, 1);
        Circle inversion = circle(args, 6);
        FoldLineSet set = new FoldLineSet();
        String outcome = invertLineSegment(set, subject, inversion);
        System.out.println("outcome|" + outcome);
        printFoldLineSet(set);
        printCircleSet(set);
    }

    private static String invertLineSegment(FoldLineSet set, LineSegment subject, Circle inversion) {
        StraightLine ty = new StraightLine(subject);
        if (ty.calculateDistance(inversion.determineCenter()) < Epsilon.UNKNOWN_1EN7) {
            return "none";
        }

        Circle added = new Circle();
        added.set(inversion.turnAround_LineSegmentToCircle(subject));
        added.setColor(LineColor.CYAN_3);
        set.getCircles().add(added);
        return "circle";
    }

    private static void foldLineCircleOrganize(String[] args) {
        if (args.length < 3) {
            usage("foldline-circle-organize expects circles followed by fold lines");
        }

        int circleCount = Integer.parseInt(args[1]);
        int lineCountOffset = 2 + circleCount * 4;
        if (args.length < lineCountOffset + 1) {
            usage("foldline-circle-organize missing line count");
        }
        int lineCount = Integer.parseInt(args[lineCountOffset]);
        int expectedLength = lineCountOffset + 1 + lineCount * 5;
        if (args.length != expectedLength) {
            usage("foldline-circle-organize payload length mismatch");
        }

        FoldLineSet set = new FoldLineSet();
        for (int i = 0; i < circleCount; i++) {
            set.getCircles().add(circle(args, 2 + i * 4));
        }
        for (int i = 0; i < lineCount; i++) {
            LineSegment line = segment(args, lineCountOffset + 1 + i * 5);
            set.addLine(line);
        }

        int before = set.getCircles().size();
        OrganizeCircles.apply(set);
        System.out.println("deleted|" + (before - set.getCircles().size()));
        printCircleSet(set);
    }

    private static void foldLineCircleChangeColor(String[] args) {
        if (args.length < 8) {
            usage("foldline-circle-change-color expects index sets, rgb color, circles, and fold lines");
        }

        List<Integer> circleIndices = parseIndices(args[1]);
        List<Integer> auxLineIndices = parseIndices(args[2]);
        Color color = new Color(
                Integer.parseInt(args[3]),
                Integer.parseInt(args[4]),
                Integer.parseInt(args[5]));
        int circleCount = Integer.parseInt(args[6]);
        int lineCountOffset = 7 + circleCount * 4;
        if (args.length < lineCountOffset + 1) {
            usage("foldline-circle-change-color missing line count");
        }
        int lineCount = Integer.parseInt(args[lineCountOffset]);
        int expectedLength = lineCountOffset + 1 + lineCount * 5;
        if (args.length != expectedLength) {
            usage("foldline-circle-change-color payload length mismatch");
        }

        FoldLineSet set = new FoldLineSet();
        for (int i = 0; i < circleCount; i++) {
            set.getCircles().add(circle(args, 7 + i * 4));
        }
        for (int i = 0; i < lineCount; i++) {
            set.addLine(segment(args, lineCountOffset + 1 + i * 5));
        }

        int changed = 0;
        for (int index : circleIndices) {
            if (index >= 0 && index < set.getCircles().size()) {
                set.setCircleCustomizedColor(set.getCircles().get(index), color);
                changed++;
            }
        }
        for (int index : auxLineIndices) {
            if (index >= 0 && index < set.getTotal()) {
                LineSegment line = set.get(index + 1);
                if (line.getColor() == LineColor.CYAN_3) {
                    set.setCustomized(line, color);
                    changed++;
                }
            }
        }

        System.out.println("changed|" + changed);
        printCircleSet(set);
        printFoldLineSetWithCustomization(set);
    }

    private static void foldLineCircleTangentPoint(String[] args) {
        if (args.length < 8) {
            usage("foldline-circle-tangent-point expects point, circle, line count, and fold lines");
        }

        Point point = new Point(parse(args[1]), parse(args[2]));
        Circle circle = circle(args, 3);
        int lineCount = Integer.parseInt(args[7]);
        FoldLineSet set = foldLineSet(args, 8, lineCount);
        printLineSegmentsList(tangentPointCircle(set, point, circle));
    }

    private static List<LineSegment> tangentPointCircle(FoldLineSet set, Point point, Circle circle) {
        List<LineSegment> indicators = new ArrayList<>();
        if (Math.abs(circle.getR() - OritaCalc.distance(circle.determineCenter(), point)) < Epsilon.UNKNOWN_1EN7) {
            LineSegment projectionLine = new LineSegment(circle.determineCenter(), point);
            indicators.add(OritaCalc.fullExtendUntilHit(set, new LineSegment(point,
                    OritaCalc.findProjection(OritaCalc.moveParallel(projectionLine, 1), point),
                    LineColor.PURPLE_8)));
            indicators.add(OritaCalc.fullExtendUntilHit(set, new LineSegment(point,
                    OritaCalc.findProjection(OritaCalc.moveParallel(projectionLine, -1), point),
                    LineColor.PURPLE_8)));
            return indicators;
        }
        LineSegment diameter = new LineSegment(point, circle.determineCenter());
        Circle constructCir = new Circle(diameter, LineColor.GREEN_6);
        LineSegment connectSegment = OritaCalc
                .circle_to_circle_no_intersection_wo_musubu_lineSegment(constructCir, circle);
        indicators.add(new LineSegment(point, connectSegment.getA(), LineColor.PURPLE_8));
        indicators.add(new LineSegment(point, connectSegment.getB(), LineColor.PURPLE_8));
        return indicators;
    }

    private static void foldLineCircleTangentTwo(String[] args) {
        if (args.length != 9) {
            usage("foldline-circle-tangent-two expects two circles");
        }

        printLineSegmentsList(tangentTwoCircles(circle(args, 1), circle(args, 5)));
    }

    private static List<LineSegment> tangentTwoCircles(Circle circle1, Circle circle2) {
        List<LineSegment> indicators = new ArrayList<>();
        Point c1 = circle1.determineCenter();
        Point c2 = circle2.determineCenter();

        double x1 = circle1.getX();
        double y1 = circle1.getY();
        double r1 = circle1.getR();
        double x2 = circle2.getX();
        double y2 = circle2.getY();
        double r2 = circle2.getR();
        double xp = x2 - x1;
        double yp = y2 - y1;
        double distanceSquared = xp * xp + yp * yp;
        double radiusDifferenceSquared = (r1 - r2) * (r1 - r2);
        double radiusSumSquared = (r1 + r2) * (r1 + r2);

        if (c1.distance(c2) < Epsilon.UNKNOWN_1EN6) return indicators;
        if (distanceSquared < radiusDifferenceSquared) return indicators;

        if (Math.abs(distanceSquared - radiusDifferenceSquared) < Epsilon.UNKNOWN_1EN7) {
            Point kouten = OritaCalc.internalDivisionRatio(c1, c2, -r1, r2);
            StraightLine ty = new StraightLine(c1, kouten).orthogonalize(kouten);
            indicators.add(OritaCalc.circle_to_straightLine_no_intersect_wo_connect_LineSegment(
                    new Circle(kouten, (r1 + r2) / 2.0, LineColor.BLACK_0), ty)
                    .withColor(LineColor.PURPLE_8));
            return indicators;
        }

        indicators.addAll(externalTangentSegments(x1, y1, x2, y2, r1, r2, xp, yp, distanceSquared));
        if (radiusDifferenceSquared < distanceSquared && distanceSquared < radiusSumSquared) {
            return indicators;
        }
        if (Math.abs(distanceSquared - radiusSumSquared) < Epsilon.UNKNOWN_1EN7) {
            Point kouten = OritaCalc.internalDivisionRatio(c1, c2, r1, r2);
            StraightLine ty = new StraightLine(c1, kouten).orthogonalize(kouten);
            indicators.add(OritaCalc.circle_to_straightLine_no_intersect_wo_connect_LineSegment(
                    new Circle(kouten, (r1 + r2) / 2.0, LineColor.BLACK_0), ty)
                    .withColor(LineColor.PURPLE_8));
            return indicators;
        }
        if (radiusSumSquared < distanceSquared) {
            indicators.addAll(internalTangentSegments(x1, y1, x2, y2, r1, r2, xp, yp, distanceSquared));
        }
        return indicators;
    }

    private static List<LineSegment> externalTangentSegments(double x1, double y1, double x2, double y2,
                                                             double r1, double r2, double xp, double yp,
                                                             double distanceSquared) {
        double root = Math.sqrt(distanceSquared - (r1 - r2) * (r1 - r2));
        double xq1 = r1 * (xp * (r1 - r2) + yp * root) / distanceSquared;
        double yq1 = r1 * (yp * (r1 - r2) - xp * root) / distanceSquared;
        double xq2 = r1 * (xp * (r1 - r2) - yp * root) / distanceSquared;
        double yq2 = r1 * (yp * (r1 - r2) + xp * root) / distanceSquared;
        return tangentSegmentsFromOffsets(x1, y1, x2, y2, new double[][]{{xq1, yq1}, {xq2, yq2}});
    }

    private static List<LineSegment> internalTangentSegments(double x1, double y1, double x2, double y2,
                                                             double r1, double r2, double xp, double yp,
                                                             double distanceSquared) {
        double root = Math.sqrt(distanceSquared - (r1 + r2) * (r1 + r2));
        double xq3 = r1 * (xp * (r1 + r2) + yp * root) / distanceSquared;
        double yq3 = r1 * (yp * (r1 + r2) - xp * root) / distanceSquared;
        double xq4 = r1 * (xp * (r1 + r2) - yp * root) / distanceSquared;
        double yq4 = r1 * (yp * (r1 + r2) + xp * root) / distanceSquared;
        return tangentSegmentsFromOffsets(x1, y1, x2, y2, new double[][]{{xq3, yq3}, {xq4, yq4}});
    }

    private static List<LineSegment> tangentSegmentsFromOffsets(double x1, double y1, double x2, double y2, double[][] offsets) {
        List<LineSegment> indicators = new ArrayList<>();
        for (double[] offset : offsets) {
            double xr = offset[0] + x1;
            double yr = offset[1] + y1;
            StraightLine t = new StraightLine(x1, y1, xr, yr).orthogonalize(new Point(xr, yr));
            indicators.add(new LineSegment(new Point(xr, yr),
                    OritaCalc.findProjection(t, new Point(x2, y2)),
                    LineColor.PURPLE_8));
        }
        return indicators;
    }

    private static void foldLineRegularPolygon(String[] args) {
        if (args.length < 8) {
            usage("foldline-regular-polygon expects corners, color, points, count, and fold lines");
        }

        int corners = Integer.parseInt(args[1]);
        LineColor color = LineColor.fromNumber(Integer.parseInt(args[2]));
        Point p1 = new Point(parse(args[3]), parse(args[4]));
        Point p2 = new Point(parse(args[5]), parse(args[6]));
        int count = Integer.parseInt(args[7]);
        FoldLineSet set = foldLineSet(args, 8, count);
        int added = 0;

        LineSegment seed = new LineSegment(p1, p2, color);
        addLineSegmentLikeWorker(set, seed);
        added++;
        if (corners >= 2) {
            for (int i = 2; i <= corners; i++) {
                LineSegment rotated = OritaCalc.lineSegment_rotate(
                        seed,
                        (double) (corners - 2) * 180.0 / (double) corners);
                seed = new LineSegment(rotated.getB(), rotated.getA(), color);
                addLineSegmentLikeWorker(set, seed);
                added++;
            }
        }

        System.out.println("added|" + added);
        printFoldLineSet(set);
    }

    private static void foldLineVoronoi(String[] args) {
        if (args.length < 7) {
            usage("foldline-voronoi expects selection distance, color, apply flag, fold lines, circles, and seed points");
        }

        int cursor = 1;
        double selectionDistance = parse(args[cursor++]);
        LineColor color = LineColor.fromNumber(Integer.parseInt(args[cursor++]));
        boolean apply = Boolean.parseBoolean(args[cursor++]);
        int lineCount = Integer.parseInt(args[cursor++]);
        FoldLineSet set = new FoldLineSet();
        for (int index = 0; index < lineCount; index++) {
            LineSegment segment = segment(args, cursor);
            set.addLine(segment.getA(), segment.getB(), segment.getColor());
            cursor += 5;
        }
        int circleCount = Integer.parseInt(args[cursor++]);
        for (int index = 0; index < circleCount; index++) {
            set.getCircles().add(circle(args, cursor));
            cursor += 4;
        }
        int pointCount = Integer.parseInt(args[cursor++]);
        OracleVoronoiState state = new OracleVoronoiState();
        for (int index = 0; index < pointCount; index++) {
            Point point = new Point(parse(args[cursor]), parse(args[cursor + 1]));
            cursor += 2;
            voronoiPress(set, state, point, selectionDistance);
        }
        if (cursor != args.length) {
            usage("foldline-voronoi payload length mismatch");
        }

        if (apply) {
            int linesAdded = 0;
            int circlesAdded = 0;
            for (OracleVoronoiLineSegment line : state.lineSegments) {
                addLineSegmentLikeWorker(set, line.lineSegment.withColor(color));
                linesAdded++;
            }
            for (Point seed : state.seedPoints) {
                set.getCircles().add(new Circle(seed.getX(), seed.getY(), 5.0, LineColor.CYAN_3));
                circlesAdded++;
            }
            state.reset();
            System.out.println("applied|" + linesAdded + "|" + circlesAdded);
            printFoldLineSet(set);
            printCircleSet(set);
        } else {
            printVoronoiState(state);
        }
    }

    private static void voronoiPress(
            FoldLineSet set,
            OracleVoronoiState state,
            Point point,
            double selectionDistance) {
        Point closestPoint = closestOperationFramePoint(set, point);
        Point selectedPoint = point.distance(closestPoint) < selectionDistance ? closestPoint : point;

        int overlappingSeedPointIndex = -1;
        for (int index = 0; index < state.seedPoints.size(); index++) {
            if (OritaCalc.distance(state.seedPoints.get(index), selectedPoint) <= selectionDistance) {
                overlappingSeedPointIndex = index;
            }
        }

        if (overlappingSeedPointIndex == -1) {
            state.seedPoints.add(selectedPoint);
            voronoi02(state);
        } else {
            voronoiRemoveSeed(state, overlappingSeedPointIndex);
        }
    }

    private static void voronoiRemoveSeed(OracleVoronoiState state, int overlappingSeedPointIndex) {
        if (state.seedPoints.isEmpty()) {
            return;
        }

        int lastIndex = state.seedPoints.size() - 1;
        Point replacement = state.seedPoints.get(overlappingSeedPointIndex);
        state.seedPoints.set(overlappingSeedPointIndex, state.seedPoints.get(lastIndex));
        state.seedPoints.set(lastIndex, replacement);

        for (OracleVoronoiLineSegment line : state.lineSegments) {
            if (line.voronoiA == overlappingSeedPointIndex) {
                line.voronoiA = lastIndex;
            } else if (line.voronoiA == lastIndex) {
                line.voronoiA = overlappingSeedPointIndex;
            }

            if (line.voronoiB == overlappingSeedPointIndex) {
                line.voronoiB = lastIndex;
            } else if (line.voronoiB == lastIndex) {
                line.voronoiB = overlappingSeedPointIndex;
            }
        }

        state.seedPoints.remove(lastIndex);
        int removedIndex = state.seedPoints.size();
        List<OracleVoronoiLineSegment> replacements = new ArrayList<>();

        for (OracleVoronoiLineSegment line : state.lineSegments) {
            line.selected = 0;
        }

        for (OracleVoronoiLineSegment line : state.lineSegments) {
            if (line.voronoiA == removedIndex) {
                line.selected = 2;
                int neighbor = line.voronoiB;
                voronoiSelectNeighborLines(state, neighbor);
                senbBoro1pMotome(state, neighbor);
                addUniqueVoronoiLines(replacements, state.linesAroundNewPoint);
            } else if (line.voronoiB == removedIndex) {
                line.selected = 2;
                int neighbor = line.voronoiA;
                voronoiSelectNeighborLines(state, neighbor);
                senbBoro1pMotome(state, neighbor);
                addUniqueVoronoiLines(replacements, state.linesAroundNewPoint);
            }
        }

        state.lineSegments = state.lineSegments.stream()
                .filter(line -> line.selected != 2)
                .collect(java.util.stream.Collectors.toCollection(ArrayList::new));
        state.lineSegments.addAll(replacements);
    }

    private static void voronoiSelectNeighborLines(OracleVoronoiState state, int neighbor) {
        for (OracleVoronoiLineSegment line : state.lineSegments) {
            if (line.voronoiA == neighbor || line.voronoiB == neighbor) {
                line.selected = 2;
            }
        }
    }

    private static void addUniqueVoronoiLines(
            List<OracleVoronoiLineSegment> target,
            List<OracleVoronoiLineSegment> source) {
        for (OracleVoronoiLineSegment line : source) {
            boolean add = true;
            for (OracleVoronoiLineSegment existing : target) {
                if (line.voronoiB == existing.voronoiB && line.voronoiA == existing.voronoiA) {
                    add = false;
                }
                if (line.voronoiB == existing.voronoiA && line.voronoiA == existing.voronoiB) {
                    add = false;
                }
            }
            if (add) {
                target.add(new OracleVoronoiLineSegment(line));
            }
        }
    }

    private static void voronoi02(OracleVoronoiState state) {
        int newSeedPointIndex = state.seedPoints.size() - 1;
        senbBoro1pMotome(state, newSeedPointIndex);

        for (OracleVoronoiLineSegment line : state.lineSegments) {
            line.selected = 0;
        }

        for (int ia = 0; ia < state.linesAroundNewPoint.size() - 1; ia++) {
            for (int ib = ia + 1; ib < state.linesAroundNewPoint.size(); ib++) {
                OracleVoronoiLineSegment sBegin = new OracleVoronoiLineSegment(state.linesAroundNewPoint.get(ia));
                OracleVoronoiLineSegment sEnd = new OracleVoronoiLineSegment(state.linesAroundNewPoint.get(ib));
                StraightLine tBegin = new StraightLine(sBegin.lineSegment);

                int iBegin = sBegin.voronoiA;
                int iEnd = sEnd.voronoiA;
                if (iBegin > iEnd) {
                    int temp = iBegin;
                    iBegin = iEnd;
                    iEnd = temp;
                }

                for (int index = 0; index < state.lineSegments.size(); index++) {
                    OracleVoronoiLineSegment existing = state.lineSegments.get(index);
                    int existingLow = existing.voronoiA;
                    int existingHigh = existing.voronoiB;
                    if (existingLow > existingHigh) {
                        existingHigh = existing.voronoiA;
                        existingLow = existing.voronoiB;
                    }

                    if (existingLow == iBegin && existingHigh == iEnd) {
                        Point intersection = OritaCalc.findIntersection(sBegin.lineSegment, existing.lineSegment);
                        Point newSeed = state.seedPoints.get(newSeedPointIndex);
                        if (tBegin.sameSide(newSeed, existing.lineSegment.getA()) >= 0
                                && tBegin.sameSide(newSeed, existing.lineSegment.getB()) >= 0) {
                            existing.selected = 2;
                        }

                        if (tBegin.sameSide(newSeed, existing.lineSegment.getA()) == -1
                                && tBegin.sameSide(newSeed, existing.lineSegment.getB()) == 1) {
                            state.lineSegments.set(index, existing.withB(intersection));
                        }

                        if (tBegin.sameSide(newSeed, existing.lineSegment.getA()) == 1
                                && tBegin.sameSide(newSeed, existing.lineSegment.getB()) == -1) {
                            state.lineSegments.set(index, existing.withA(intersection));
                        }
                    }
                }
            }
        }

        state.lineSegments = state.lineSegments.stream()
                .filter(line -> line.selected != 2)
                .collect(java.util.stream.Collectors.toCollection(ArrayList::new));
        state.lineSegments.addAll(state.linesAroundNewPoint.stream()
                .map(OracleVoronoiLineSegment::new)
                .toList());
    }

    private static void senbBoro1pMotome(OracleVoronoiState state, int newSeedPointIndex) {
        state.linesAroundNewPoint.clear();

        for (int seedIndex = 0; seedIndex < state.seedPoints.size(); seedIndex++) {
            if (seedIndex != newSeedPointIndex) {
                OracleVoronoiLineSegment addLine = new OracleVoronoiLineSegment(
                        OritaCalc.bisection(
                                state.seedPoints.get(seedIndex),
                                state.seedPoints.get(newSeedPointIndex),
                                1000.0));

                if (seedIndex < newSeedPointIndex) {
                    addLine.voronoiA = seedIndex;
                    addLine.voronoiB = newSeedPointIndex;
                } else {
                    addLine.voronoiA = newSeedPointIndex;
                    addLine.voronoiB = seedIndex;
                }
                voronoi0201(state, newSeedPointIndex, addLine);
            }
        }
    }

    private static void voronoi0201(
            OracleVoronoiState state,
            int newSeedPointIndex,
            OracleVoronoiLineSegment addLine) {
        StraightLine addStraightLine = new StraightLine(addLine.lineSegment);

        for (int index = state.linesAroundNewPoint.size() - 1; index >= 0; index--) {
            OracleVoronoiLineSegment existingLine = new OracleVoronoiLineSegment(
                    state.linesAroundNewPoint.get(index));
            StraightLine existingStraightLine = new StraightLine(existingLine.lineSegment);
            OritaCalc.ParallelJudgement parallel = OritaCalc.isLineSegmentParallel(
                    addStraightLine,
                    existingStraightLine,
                    Epsilon.UNKNOWN_1EN4);

            Point seed = state.seedPoints.get(newSeedPointIndex);
            if (parallel == OritaCalc.ParallelJudgement.PARALLEL_EQUAL) {
                return;
            }
            if (parallel == OritaCalc.ParallelJudgement.PARALLEL_NOT_EQUAL) {
                if (addStraightLine.sameSide(seed, existingLine.lineSegment.getA()) == -1) {
                    state.linesAroundNewPoint.remove(index);
                } else if (existingStraightLine.sameSide(seed, addLine.lineSegment.getA()) == -1) {
                    return;
                }
            } else if (parallel == OritaCalc.ParallelJudgement.NOT_PARALLEL) {
                Point intersection = OritaCalc.findIntersection(addLine.lineSegment, existingLine.lineSegment);

                if (addStraightLine.sameSide(seed, existingLine.lineSegment.getA()) <= 0
                        && addStraightLine.sameSide(seed, existingLine.lineSegment.getB()) <= 0) {
                    state.linesAroundNewPoint.remove(index);
                } else if (addStraightLine.sameSide(seed, existingLine.lineSegment.getA()) == 1
                        && addStraightLine.sameSide(seed, existingLine.lineSegment.getB()) == -1) {
                    existingLine = existingLine.withB(intersection);
                    if (existingLine.lineSegment.determineLength() < Epsilon.UNKNOWN_1EN7) {
                        state.linesAroundNewPoint.remove(index);
                    } else {
                        state.linesAroundNewPoint.set(index, existingLine);
                    }
                } else if (addStraightLine.sameSide(seed, existingLine.lineSegment.getA()) == -1
                        && addStraightLine.sameSide(seed, existingLine.lineSegment.getB()) == 1) {
                    existingLine = existingLine.withA(intersection);
                    if (existingLine.lineSegment.determineLength() < Epsilon.UNKNOWN_1EN7) {
                        state.linesAroundNewPoint.remove(index);
                    } else {
                        state.linesAroundNewPoint.set(index, existingLine);
                    }
                }

                if (existingStraightLine.sameSide(seed, addLine.lineSegment.getA()) <= 0
                        && existingStraightLine.sameSide(seed, addLine.lineSegment.getB()) <= 0) {
                    return;
                } else if (existingStraightLine.sameSide(seed, addLine.lineSegment.getA()) == 1
                        && existingStraightLine.sameSide(seed, addLine.lineSegment.getB()) == -1) {
                    addLine = addLine.withB(intersection);
                    if (addLine.lineSegment.determineLength() < Epsilon.UNKNOWN_1EN7) {
                        return;
                    }
                } else if (existingStraightLine.sameSide(seed, addLine.lineSegment.getA()) == -1
                        && existingStraightLine.sameSide(seed, addLine.lineSegment.getB()) == 1) {
                    addLine = addLine.withA(intersection);
                    if (addLine.lineSegment.determineLength() < Epsilon.UNKNOWN_1EN7) {
                        return;
                    }
                }
            }
        }

        state.linesAroundNewPoint.add(addLine);
    }

    private static void foldLineDefaultMolecule(String[] args) throws Exception {
        if (args.length < 8) {
            usage("foldline-default-molecule expects resource path, color, points, count, and fold lines");
        }

        Save originalSave = defaultMoleculeSave(args[1]);
        LineColor color = LineColor.fromNumber(Integer.parseInt(args[2]));
        Point p1 = new Point(parse(args[3]), parse(args[4]));
        Point p2 = new Point(parse(args[5]), parse(args[6]));
        int count = Integer.parseInt(args[7]);
        FoldLineSet set = foldLineSet(args, 8, count);
        int added = 0;

        if (p2.distance(p1) >= Epsilon.UNKNOWN_1EN6) {
            List<Circle> startingCircles = originalSave.getCircles().stream()
                    .filter(circle -> circle.getR() > Epsilon.UNKNOWN_1EN6)
                    .toList();
            if (startingCircles.size() >= 2) {
                FoldLineSet templateSet = new FoldLineSet();
                templateSet.setSave(originalSave);
                templateSet.move(
                        startingCircles.get(0).determineCenter(),
                        startingCircles.get(1).determineCenter(),
                        p1,
                        p2);
                for (LineSegment segment : templateSet.getLineSegments()) {
                    if (segment.determineLength() > Epsilon.UNKNOWN_1EN6) {
                        addLineSegmentLikeWorker(set, segment.withColor(color));
                        added++;
                    }
                }
            }
        }

        System.out.println("added|" + added);
        printFoldLineSet(set);
    }

    private static void flatFoldableBoundaryCheck(String[] args) {
        if (args.length < 3) {
            usage("flat-foldable-boundary-check expects boundary lines and fold lines");
        }

        int cursor = 1;
        int boundaryCount = Integer.parseInt(args[cursor++]);
        List<LineSegment> boundary = new ArrayList<>();
        for (int index = 0; index < boundaryCount; index++) {
            boundary.add(segment(args, cursor));
            cursor += 5;
        }
        int count = Integer.parseInt(args[cursor++]);
        FoldLineSet set = foldLineSet(args, cursor, count);

        boolean suitable = true;
        List<LineSegment> orderedCrossings = new ArrayList<>();
        for (LineSegment boundarySegment : boundary) {
            SortingBox<LineSegment> nbox = new SortingBox<>();
            for (LineSegment segment : set.getLineSegmentsIterable()) {
                LineSegment.Intersection intersection = OritaCalc.determineLineSegmentIntersection(
                        segment,
                        boundarySegment,
                        Epsilon.UNKNOWN_1EN4);
                int execute = 0;

                if (intersection != LineSegment.Intersection.NO_INTERSECTION_0
                        && intersection != LineSegment.Intersection.INTERSECTS_1) {
                    suitable = false;
                }

                if (intersection == LineSegment.Intersection.INTERSECTS_1) {
                    execute = 1;
                }

                if (segment.getColor().getNumber() >= 3) {
                    execute = 0;
                }

                if (execute == 1) {
                    nbox.addByWeight(
                            segment,
                            OritaCalc.distance(
                                    boundarySegment.getA(),
                                    OritaCalc.findIntersection(segment, boundarySegment)));
                }
            }

            for (int index = 1; index <= nbox.getTotal(); index++) {
                orderedCrossings.add(nbox.getValue(index));
            }
        }

        LineColor resultColor = LineColor.YELLOW_7;
        if (suitable) {
            if (orderedCrossings.size() % 2 != 0) {
                resultColor = LineColor.MAGENTA_5;
            } else if (orderedCrossings.isEmpty()) {
                resultColor = LineColor.CYAN_3;
            } else {
                LineSegment moved = new LineSegment(orderedCrossings.get(0));
                for (int index = 1; index < orderedCrossings.size(); index++) {
                    moved = OritaCalc.findLineSymmetryLineSegment(moved, orderedCrossings.get(index));
                }
                resultColor = LineColor.MAGENTA_5;
                if (OritaCalc.equal(orderedCrossings.get(0).getA(), moved.getA(), Epsilon.UNKNOWN_1EN4)
                        && OritaCalc.equal(orderedCrossings.get(0).getB(), moved.getB(), Epsilon.UNKNOWN_1EN4)) {
                    resultColor = LineColor.CYAN_3;
                }
            }

            for (int index = 0; index < boundary.size(); index++) {
                boundary.set(index, boundary.get(index).withColor(resultColor));
            }
        }

        System.out.println("result|" + resultColor.getNumber() + "|" + suitable + "|" + orderedCrossings.size());
        printLineSegmentsList(boundary);
    }

    private static void textSequence(String[] args) {
        if (args.length < 6) {
            usage("text-sequence expects selected state, texts, and events");
        }

        int cursor = 1;
        OracleTextState state = new OracleTextState();
        state.selected = Integer.parseInt(args[cursor++]);
        state.isSelected = Boolean.parseBoolean(args[cursor++]);
        state.dirty = Boolean.parseBoolean(args[cursor++]);
        int textCount = Integer.parseInt(args[cursor++]);
        List<Text> texts = new ArrayList<>();
        for (int index = 0; index < textCount; index++) {
            texts.add(new Text(parse(args[cursor]), parse(args[cursor + 1]), args[cursor + 2]));
            cursor += 3;
        }
        int eventCount = Integer.parseInt(args[cursor++]);
        for (int index = 0; index < eventCount; index++) {
            String event = args[cursor++];
            switch (event) {
                case "press" -> {
                    Point point = new Point(parse(args[cursor]), parse(args[cursor + 1]));
                    cursor += 2;
                    textCreateOrSelectPressed(texts, state, point);
                }
                case "drag" -> {
                    Point point = new Point(parse(args[cursor]), parse(args[cursor + 1]));
                    cursor += 2;
                    textDragSelected(texts, state, point);
                }
                case "delete" -> {
                    Point point = new Point(parse(args[cursor]), parse(args[cursor + 1]));
                    cursor += 2;
                    textDeleteAt(texts, state, point);
                }
                case "box" -> {
                    Point first = new Point(parse(args[cursor]), parse(args[cursor + 1]));
                    Point second = new Point(parse(args[cursor + 2]), parse(args[cursor + 3]));
                    cursor += 4;
                    textDeleteBox(texts, state, first, second);
                }
                default -> usage("unknown text event: " + event);
            }
        }
        if (cursor != args.length) {
            usage("text-sequence payload length mismatch");
        }

        printTextState(texts, state);
    }

    private static void textCreateOrSelectPressed(List<Text> texts, OracleTextState state, Point point) {
        if (state.isSelected) {
            if (!trySelectText(texts, state, point)) {
                state.isSelected = false;
                if (state.dirty) {
                    state.dirty = false;
                }
            }
        } else {
            selectOrCreateText(texts, state, point);
        }
        state.selectionStart = point;
    }

    private static void textDragSelected(List<Text> texts, OracleTextState state, Point point) {
        if (!state.isSelected || state.selected < 0 || state.selected >= texts.size() || state.selectionStart == null) {
            return;
        }
        Text text = texts.get(state.selected);
        text.setY(text.getY() + point.getY() - state.selectionStart.getY());
        text.setX(text.getX() + point.getX() - state.selectionStart.getX());
        state.dirty = true;
        state.selectionStart = point;
    }

    private static boolean textDeleteAt(List<Text> texts, OracleTextState state, Point point) {
        int nearest = findNearestText(texts, state, point);
        if (nearest == -1) {
            return false;
        }
        texts.remove(nearest);
        reconcileDeletedText(state, nearest);
        state.dirty = false;
        return true;
    }

    private static int textDeleteBox(List<Text> texts, OracleTextState state, Point first, Point second) {
        Rectangle selection = textSelectionRectangle(first, second);
        List<Integer> deleted = new ArrayList<>();
        for (int index = 0; index < texts.size(); index++) {
            Rectangle bounds = textDeleteBounds(texts.get(index));
            if (selection.contains(bounds) || selection.intersects(bounds) || bounds.contains(selection)) {
                deleted.add(index);
            }
        }

        for (int index = deleted.size() - 1; index >= 0; index--) {
            int deletedIndex = deleted.get(index);
            texts.remove(deletedIndex);
            reconcileDeletedText(state, deletedIndex);
        }
        if (!deleted.isEmpty()) {
            state.dirty = false;
        }
        return deleted.size();
    }

    private static void selectOrCreateText(List<Text> texts, OracleTextState state, Point point) {
        if (!trySelectText(texts, state, point)) {
            if (state.isSelected && state.dirty) {
                state.dirty = false;
            }
            texts.add(new Text(point.getX(), point.getY(), ""));
            state.selected = texts.size() - 1;
        }
        state.isSelected = true;
    }

    private static boolean trySelectText(List<Text> texts, OracleTextState state, Point point) {
        int nearest = findNearestText(texts, state, point);
        if (nearest == -1) {
            return false;
        }
        if (state.isSelected && state.selected != nearest && state.dirty) {
            state.dirty = false;
        }
        state.selected = nearest;
        return true;
    }

    private static int findNearestText(List<Text> texts, OracleTextState state, Point point) {
        double minDist = 100000000.0;
        int nearest = -1;
        java.awt.Point awtPoint = new java.awt.Point((int) point.getX(), (int) point.getY());
        for (int index = 0; index < texts.size(); index++) {
            Text text = texts.get(index);
            Rectangle bounds = textSelectionBounds(text, state.isSelected && state.selected == index);
            if (bounds.contains(awtPoint)) {
                double distance = point.distance(text.getPos());
                if (distance < minDist) {
                    minDist = distance;
                    nearest = index;
                }
            }
        }
        return nearest;
    }

    private static void reconcileDeletedText(OracleTextState state, int deletedIndex) {
        if (state.selected == deletedIndex) {
            state.selected = -1;
            state.isSelected = false;
        } else if (deletedIndex < state.selected) {
            state.selected--;
        }
    }

    private static Rectangle textSelectionBounds(Text text, boolean selected) {
        Point pos = text.getPos();
        Rectangle bounds = text.calculateBounds();
        int selectionRadius = selected ? 7 : 1;
        bounds.setLocation((int) pos.getX() - 3 - selectionRadius, (int) pos.getY() - 10 - selectionRadius);
        bounds.setSize(bounds.width + 8 + selectionRadius * 5, bounds.height + 10 + selectionRadius * 5);
        return bounds;
    }

    private static Rectangle textDeleteBounds(Text text) {
        Rectangle bounds = text.calculateBounds();
        Point pos = text.getPos();
        bounds.setLocation((int) pos.getX(), (int) pos.getY());
        return bounds;
    }

    private static Rectangle textSelectionRectangle(Point first, Point second) {
        if (first.getX() > second.getX()) {
            double tmp = first.getX();
            first = first.withX(second.getX());
            second = second.withX(tmp);
        }
        if (first.getY() > second.getY()) {
            double tmp = first.getY();
            first = first.withY(second.getY());
            second = second.withY(tmp);
        }
        return new Rectangle(
                (int) first.getX(),
                (int) first.getY(),
                (int) (second.getX() - first.getX()),
                (int) (second.getY() - first.getY()));
    }

    private static Save defaultMoleculeSave(String path) throws Exception {
        String json = Files.readString(new File(path).toPath());
        List<Point> vertices = parsePointPairs(extractJsonArray(json, "vertices_coords"));
        List<int[]> edges = parseIntPairs(extractJsonArray(json, "edges_vertices"));
        List<String> assignments = parseStringArray(extractJsonArray(json, "edges_assignment"));

        Save save = SaveProvider.createInstance();
        double minX = Double.MAX_VALUE;
        double minY = Double.MAX_VALUE;
        double maxY = Double.MIN_VALUE;

        for (int index = 0; index < edges.size(); index++) {
            int[] edge = edges.get(index);
            Point a = vertices.get(edge[0]);
            Point b = vertices.get(edge[1]);
            minX = Math.min(Math.min(minX, a.getX()), b.getX());
            minY = Math.min(Math.min(minY, a.getY()), b.getY());
            maxY = Math.max(Math.max(maxY, a.getY()), b.getY());
            save.addLineSegment(new LineSegment(a, b, foldAssignmentColor(assignments, index)));
        }
        save.setCircles(parseCircles(json));

        FoldLineSet normalized = new FoldLineSet();
        normalized.setSave(save);
        normalized.move(
                new Point(minX, minY),
                new Point(minX, maxY),
                new Point(-200.0, -200.0),
                new Point(-200.0, 200.0));
        Save normalizedSave = SaveProvider.createInstance();
        normalized.getSave(normalizedSave);
        return normalizedSave;
    }

    private static LineColor foldAssignmentColor(List<String> assignments, int index) {
        if (index >= assignments.size()) {
            return LineColor.BLACK_0;
        }
        return switch (assignments.get(index)) {
            case "M" -> LineColor.RED_1;
            case "V" -> LineColor.BLUE_2;
            case "F" -> LineColor.CYAN_3;
            default -> LineColor.BLACK_0;
        };
    }

    private static List<Circle> parseCircles(String json) {
        List<Point> centers = parsePointPairs(extractJsonArray(json, "oriedita:circles_coords"));
        List<Double> radii = parseDoubleArray(extractJsonArray(json, "oriedita:circles_radii"));
        List<String> colors = parseStringArray(extractJsonArray(json, "oriedita:circles_colors"));
        List<Circle> circles = new ArrayList<>();
        for (int index = 0; index < centers.size(); index++) {
            Point center = centers.get(index);
            double radius = index < radii.size() ? radii.get(index) : 0.0;
            LineColor color = index < colors.size()
                    ? LineColor.fromNumber(Integer.parseInt(colors.get(index)))
                    : LineColor.BLACK_0;
            circles.add(new Circle(center.getX(), center.getY(), radius, color));
        }
        return circles;
    }

    private static String extractJsonArray(String json, String key) {
        int keyIndex = json.indexOf("\"" + key + "\"");
        if (keyIndex < 0) {
            return "[]";
        }
        int start = json.indexOf('[', keyIndex);
        if (start < 0) {
            throw new IllegalArgumentException("missing JSON array for key " + key);
        }
        int depth = 0;
        for (int index = start; index < json.length(); index++) {
            char current = json.charAt(index);
            if (current == '[') {
                depth++;
            } else if (current == ']') {
                depth--;
                if (depth == 0) {
                    return json.substring(start, index + 1);
                }
            }
        }
        throw new IllegalArgumentException("unterminated JSON array for key " + key);
    }

    private static List<Point> parsePointPairs(String array) {
        Pattern pattern = Pattern.compile("\\[\\s*(" + JSON_NUMBER + ")\\s*,\\s*(" + JSON_NUMBER + ")\\s*\\]");
        Matcher matcher = pattern.matcher(array);
        List<Point> points = new ArrayList<>();
        while (matcher.find()) {
            points.add(new Point(parse(matcher.group(1)), parse(matcher.group(2))));
        }
        return points;
    }

    private static List<int[]> parseIntPairs(String array) {
        Pattern pattern = Pattern.compile("\\[\\s*(-?\\d+)\\s*,\\s*(-?\\d+)\\s*\\]");
        Matcher matcher = pattern.matcher(array);
        List<int[]> pairs = new ArrayList<>();
        while (matcher.find()) {
            pairs.add(new int[]{Integer.parseInt(matcher.group(1)), Integer.parseInt(matcher.group(2))});
        }
        return pairs;
    }

    private static List<Double> parseDoubleArray(String array) {
        Pattern pattern = Pattern.compile(JSON_NUMBER);
        Matcher matcher = pattern.matcher(array);
        List<Double> values = new ArrayList<>();
        while (matcher.find()) {
            values.add(parse(matcher.group()));
        }
        return values;
    }

    private static List<String> parseStringArray(String array) {
        Pattern pattern = Pattern.compile("\"([^\"]*)\"");
        Matcher matcher = pattern.matcher(array);
        List<String> values = new ArrayList<>();
        while (matcher.find()) {
            values.add(matcher.group(1));
        }
        return values;
    }

    private static void foldLineDivideCount(String[] args) {
        if (args.length < 8) {
            usage("foldline-divide-count expects division count, segment, count, and segment payload");
        }

        int divisionCount = Integer.parseInt(args[1]);
        LineSegment segment = new LineSegment(
                new Point(parse(args[2]), parse(args[3])),
                new Point(parse(args[4]), parse(args[5])),
                LineColor.fromNumber(Integer.parseInt(args[6])));
        int count = Integer.parseInt(args[7]);
        FoldLineSet set = foldLineSet(args, 8, count);

        if (divisionCount != 0 && Epsilon.high.gt0(segment.determineLength())) {
            for (int i = 0; i <= divisionCount - 1; i++) {
                double ax = ((double) (divisionCount - i) * segment.determineAX()
                        + (double) i * segment.determineBX()) / ((double) divisionCount);
                double ay = ((double) (divisionCount - i) * segment.determineAY()
                        + (double) i * segment.determineBY()) / ((double) divisionCount);
                double bx = ((double) (divisionCount - i - 1) * segment.determineAX()
                        + (double) (i + 1) * segment.determineBX()) / ((double) divisionCount);
                double by = ((double) (divisionCount - i - 1) * segment.determineAY()
                        + (double) (i + 1) * segment.determineBY()) / ((double) divisionCount);
                addLineSegmentLikeWorker(set, new LineSegment(ax, ay, bx, by).withColor(segment.getColor()));
            }
        }

        printFoldLineSet(set);
    }

    private static void foldLineDivideRatio(String[] args) {
        if (args.length < 9) {
            usage("foldline-divide-ratio expects ratio s, ratio t, segment, count, and segment payload");
        }

        double ratioS = parse(args[1]);
        double ratioT = parse(args[2]);
        LineSegment segment = new LineSegment(
                new Point(parse(args[3]), parse(args[4])),
                new Point(parse(args[5]), parse(args[6])),
                LineColor.fromNumber(Integer.parseInt(args[7])));
        int count = Integer.parseInt(args[8]);
        FoldLineSet set = foldLineSet(args, 9, count);

        if (Epsilon.high.gt0(segment.determineLength())) {
            LineSegment dragSegment = segment.withAB(segment.getB(), segment.getA());
            if ((ratioS == 0.0 && ratioT != 0.0) || (ratioS != 0.0 && ratioT == 0.0)) {
                addLineSegmentLikeWorker(set, dragSegment);
            }
            if (ratioS != 0.0 && ratioT != 0.0) {
                double nx = (ratioT * dragSegment.determineBX()
                        + ratioS * dragSegment.determineAX())
                        / (ratioS + ratioT);
                double ny = (ratioT * dragSegment.determineBY()
                        + ratioS * dragSegment.determineAY())
                        / (ratioS + ratioT);
                LineSegment sAd = new LineSegment().withColor(segment.getColor());
                addLineSegmentLikeWorker(set, sAd.withCoordinates(
                        dragSegment.determineAX(),
                        dragSegment.determineAY(),
                        nx,
                        ny));
                addLineSegmentLikeWorker(set, sAd.withCoordinates(
                        dragSegment.determineBX(),
                        dragSegment.determineBY(),
                        nx,
                        ny));
            }
        }

        printFoldLineSet(set);
    }

    private static void measureLength(String[] args) {
        if (args.length != 5) {
            usage("measure-length expects two points");
        }

        Point a = new Point(parse(args[1]), parse(args[2]));
        Point b = new Point(parse(args[3]), parse(args[4]));
        System.out.println("length|" + a.distance(b));
    }

    private static void measureAngle(String[] args) {
        if (args.length != 7) {
            usage("measure-angle expects three points");
        }

        Point a = new Point(parse(args[1]), parse(args[2]));
        Point center = new Point(parse(args[3]), parse(args[4]));
        Point b = new Point(parse(args[5]), parse(args[6]));
        System.out.println("angle|" + OritaCalc.angle(center, a, center, b));
    }

    private static void orhImportSummary(String[] args) throws Exception {
        if (args.length != 2) {
            usage("orh-import-summary expects a file path");
        }

        Save save = new OrhImporter().doImport(new File(args[1]));
        printSaveSummary(save);
    }

    private static void objImportSummary(String[] args) throws Exception {
        if (args.length != 2) {
            usage("obj-import-summary expects a file path");
        }

        Save save = new ObjImporter().doImport(new File(args[1]));
        printSaveSummary(save);
    }

    private static void orhExportFixture(String[] args) throws Exception {
        if (args.length != 1) {
            usage("orh-export-fixture does not take arguments");
        }

        File file = File.createTempFile("oriedita-oracle", ".orh");
        try {
            new OrhExporter().doExport(fixtureSave(), file);
            System.out.print(Files.readString(file.toPath()));
        } finally {
            file.delete();
        }
    }

    private static void dxfExportFixture(String[] args) throws Exception {
        if (args.length != 1) {
            usage("dxf-export-fixture does not take arguments");
        }

        File file = File.createTempFile("oriedita-oracle", ".dxf");
        try {
            new DxfExporter().doExport(fixtureSave(), file);
            System.out.print(Files.readString(file.toPath()));
        } finally {
            file.delete();
        }
    }

    private static void foldTopologySummary(String[] args) throws Exception {
        if (args.length < 2) {
            usage("fold-topology-summary expects count and segment payload");
        }

        int count = Integer.parseInt(args[1]);
        LineSegmentSet set = lineSegmentSet(args, 2, count);
        if (set.getNumLineSegments() == 0) {
            set.addLine(new Point(0.0, 0.0), new Point(0.0, 0.0), LineColor.BLACK_0);
        }

        WireFrame_Worker worker = new WireFrame_Worker(3.0);
        worker.setLineSegmentSetWithoutFaceOccurence(set);
        PointSet pointSet = worker.get();
        boolean includeFaces = pointSet.calculateFaces();
        int exportedFaces = includeFaces ? pointSet.getNumFaces() : 0;

        System.out.println("topology|"
                + pointSet.getNumPoints() + "|"
                + pointSet.getNumLines() + "|"
                + exportedFaces + "|"
                + includeFaces);
        for (int i = 1; i <= pointSet.getNumPoints(); i++) {
            Point point = pointSet.getPoint(i);
            System.out.println("vertex|" + (i - 1) + "|" + point.getX() + "|" + point.getY());
        }
        for (int i = 1; i <= pointSet.getNumLines(); i++) {
            System.out.println("edge|"
                    + (i - 1) + "|"
                    + (pointSet.getBegin(i) - 1) + "|"
                    + (pointSet.getEnd(i) - 1) + "|"
                    + pointSet.getColor(i).getNumber());
        }
        if (includeFaces) {
            for (int i = 1; i <= pointSet.getNumFaces(); i++) {
                origami.folding.element.Face face = pointSet.getFace(i);
                System.out.println("face|" + (i - 1) + "|" + oracleFacePoints(face));
                System.out.println("face_edges|" + (i - 1) + "|" + oracleFaceEdges(pointSet, face));
            }
        }
    }

    private static void wireframeFoldingSummary(String[] args) throws Exception {
        if (args.length < 3) {
            usage("wireframe-folding-summary expects starting face, count, and segment payload");
        }

        int startingFace = Integer.parseInt(args[1]);
        int count = Integer.parseInt(args[2]);
        LineSegmentSet set = lineSegmentSet(args, 3, count);
        WireFrame_Worker worker = new WireFrame_Worker(3.0);
        worker.setLineSegmentSet(set);
        int resolvedStartingFace = worker.setStartingFaceId(startingFace);
        PointSet folded = worker.folding();
        printWireframeSummary(folded, worker, resolvedStartingFace);
    }

    private static void printWireframeSummary(
            PointSet pointSet,
            WireFrame_Worker worker,
            int startingFace) {
        System.out.println("wireframe|"
                + pointSet.getNumPoints() + "|"
                + pointSet.getNumLines() + "|"
                + pointSet.getNumFaces() + "|"
                + (startingFace - 1));
        for (int i = 1; i <= pointSet.getNumPoints(); i++) {
            Point point = pointSet.getPoint(i);
            System.out.println("vertex|" + (i - 1) + "|" + point.getX() + "|" + point.getY());
        }
        for (int i = 1; i <= pointSet.getNumLines(); i++) {
            System.out.println("edge|"
                    + (i - 1) + "|"
                    + (pointSet.getBegin(i) - 1) + "|"
                    + (pointSet.getEnd(i) - 1) + "|"
                    + pointSet.getColor(i).getNumber());
        }
        for (int i = 1; i <= pointSet.getNumFaces(); i++) {
            origami.folding.element.Face face = pointSet.getFace(i);
            System.out.println("face|" + (i - 1) + "|" + oracleFacePoints(face));
            System.out.println("face_position|" + (i - 1) + "|" + worker.getIFacePosition(i));
        }
    }

    private static void printSubfaceConfiguration(FoldedFigure_Worker worker) throws Exception {
        System.out.println("subfaces|"
                + worker.SubFaceTotal + "|"
                + worker.FaceIdCount_max);
        for (int i = 1; i <= worker.SubFaceTotal; i++) {
            System.out.println("subface|" + (i - 1) + "|" + oracleSubfaceFaceIds(worker.s0[i]));
        }

        SubFace[] reduced = reflectedReducedSubfaces(worker);
        System.out.println("reduced|" + Math.max(0, reduced.length - 1));
        for (int i = 1; i < reduced.length; i++) {
            System.out.println("reduced_subface|"
                    + (i - 1) + "|"
                    + subfaceOriginalIndex(worker.s0, reduced[i]) + "|"
                    + oracleSubfaceFaceIds(reduced[i]));
        }
    }

    private static void printHierarchyRelations(HierarchyList hierarchyList) {
        List<int[]> relations = new ArrayList<>();
        for (int i = 1; i <= hierarchyList.getFacesTotal(); i++) {
            for (int j = 1; j <= hierarchyList.getFacesTotal(); j++) {
                if (i != j && hierarchyList.get(i, j) == HierarchyList.ABOVE_1) {
                    relations.add(new int[] {i - 1, j - 1});
                }
            }
        }
        System.out.println("additional|" + hierarchyList.getFacesTotal() + "|" + relations.size());
        for (int[] relation : relations) {
            System.out.println("relation|" + relation[0] + "|" + relation[1]);
        }
    }

    private static void printChainPermutationSequence(
            ChainPermutationGenerator generator,
            int digits,
            int limit) throws InterruptedException {
        System.out.println("permutations|" + generator.getCount());
        if (limit <= 0) {
            return;
        }
        printChainPermutation(0, 0, generator, digits);
        for (int i = 1; i < limit; i++) {
            int changed = generator.next(digits);
            if (changed == 0) {
                System.out.println("end|" + i + "|0|" + generator.getCount());
                return;
            }
            printChainPermutation(i, changed, generator, digits);
        }
    }

    private static void printChainPermutation(
            int step,
            int changed,
            ChainPermutationGenerator generator,
            int digits) {
        StringBuilder permutation = new StringBuilder();
        for (int i = 1; i <= digits; i++) {
            if (i > 1) {
                permutation.append(",");
            }
            permutation.append(generator.getPermutation(i));
        }
        System.out.println("permutation|"
                + step + "|"
                + changed + "|"
                + generator.getCount() + "|"
                + permutation);
    }

    private static void printSubfacePermutationSequence(
            SubFace subFace,
            int faceCount,
            int limit) throws Exception {
        Method getPermutation = SubFace.class.getDeclaredMethod("getPermutation", int.class);
        getPermutation.setAccessible(true);
        System.out.println("subface_permutations|" + subFace.getPermutationCount());
        if (limit <= 0) {
            return;
        }
        printSubfacePermutation(0, 0, subFace, getPermutation, faceCount);
        for (int i = 1; i < limit; i++) {
            int changed = subFace.next(faceCount);
            if (changed == 0) {
                System.out.println("end|" + i + "|0|" + subFace.getPermutationCount());
                return;
            }
            printSubfacePermutation(i, changed, subFace, getPermutation, faceCount);
        }
    }

    private static void printSubfacePermutation(
            int step,
            int changed,
            SubFace subFace,
            Method getPermutation,
            int faceCount) throws Exception {
        StringBuilder permutation = new StringBuilder();
        for (int i = 1; i <= faceCount; i++) {
            if (i > 1) {
                permutation.append(",");
            }
            int localIndex = (Integer) getPermutation.invoke(subFace, i);
            permutation.append(subFace.getFaceId(localIndex) - 1);
        }
        System.out.println("subface_permutation|"
                + step + "|"
                + changed + "|"
                + subFace.getPermutationCount() + "|"
                + permutation);
    }

    private static void printSubfaceOverlapSearch(
            int result,
            SubFace subFace,
            int faceCount) throws Exception {
        Method getPermutation = SubFace.class.getDeclaredMethod("getPermutation", int.class);
        getPermutation.setAccessible(true);
        StringBuilder permutation = new StringBuilder();
        for (int i = 1; i <= faceCount; i++) {
            if (i > 1) {
                permutation.append(",");
            }
            int localIndex = (Integer) getPermutation.invoke(subFace, i);
            permutation.append(subFace.getFaceId(localIndex) - 1);
        }
        System.out.println("subface_overlap|"
                + result + "|"
                + subFace.getPermutationCount() + "|"
                + permutation);
    }

    private static void printFoldingEstimateAndWorker(FoldedFigure foldedFigure) {
        System.out.println("folding_estimate|"
                + foldedFigure.estimationStep.name() + "|"
                + foldedFigure.displayStyle.name() + "|"
                + foldedFigure.discovered_fold_cases + "|"
                + foldedFigure.findAnotherOverlapValid + "|"
                + foldedFigure.text_result);
        printWorkerOverlapSearch(
                foldedFigure.ip2_possibleOverlap,
                foldedFigure.foldedFigure_worker.getSubFace_valid_number(),
                foldedFigure.foldedFigure_worker.SubFaceTotal,
                foldedFigure.foldedFigure_worker.hierarchyList);
    }

    private static void printWorkerOverlapSearch(
            int result,
            int validCount,
            int subfaceCount,
            HierarchyList hierarchyList) {
        List<int[]> relations = new ArrayList<>();
        for (int i = 1; i <= hierarchyList.getFacesTotal(); i++) {
            for (int j = 1; j <= hierarchyList.getFacesTotal(); j++) {
                if (i != j && hierarchyList.get(i, j) == HierarchyList.ABOVE_1) {
                    relations.add(new int[] {i - 1, j - 1});
                }
            }
        }
        System.out.println("worker_overlap|"
                + result + "|"
                + validCount + "|"
                + subfaceCount + "|"
                + relations.size());
        for (int[] relation : relations) {
            System.out.println("relation|" + relation[0] + "|" + relation[1]);
        }
    }

    private static void printWorkerSubfaceOrder(
            SubFace[] subfaces,
            int subfaceCount,
            java.util.IdentityHashMap<SubFace, Integer> subfaceIds) {
        StringBuilder order = new StringBuilder();
        for (int i = 1; i <= subfaceCount; i++) {
            if (i > 1) {
                order.append(",");
            }
            Integer id = subfaceIds.get(subfaces[i]);
            order.append(id == null ? -1 : id);
        }
        System.out.println("worker_order|" + order);
    }

    private static void printSubfaceSwapper(
            String label,
            SubFace[] subfaces,
            int count,
            SubFaceSwappingAlgorithm swapper) {
        StringBuilder order = new StringBuilder();
        for (int i = 1; i <= count; i++) {
            if (i > 1) {
                order.append(",");
            }
            order.append(subfaces[i].getFaceId(1) - 1);
        }
        System.out.println("swapper|" + label + "|" + swapper.getVisitedCount() + "|" + order);
    }

    private static FoldedFigure_Worker configuredSubfaceWorker(PointSet folded) throws Exception {
        LineSegmentSetWorker lineWorker = new LineSegmentSetWorker();
        lineWorker.set(new LineSegmentSet(folded));
        lineWorker.split_arrangement_for_SubFace_generation();

        WireFrame_Worker subdivided = new WireFrame_Worker(3.0);
        subdivided.setLineSegmentSet(lineWorker.get());

        NoopBulletinBoard bulletinBoard = new NoopBulletinBoard();
        FoldedFigure_Worker foldedWorker = new FoldedFigure_Worker(bulletinBoard);
        FoldedFigure_Configurator configurator =
                new FoldedFigure_Configurator(bulletinBoard, foldedWorker);
        configurator.configureSubFaces(folded, subdivided.get());
        return foldedWorker;
    }

    private static HierarchyList initialHierarchyList(WireFrame_Worker flat, PointSet folded) {
        HierarchyList hierarchyList = new HierarchyList();
        hierarchyList.setFacesTotal(folded.getNumFaces());
        for (int i = 1; i <= flat.getNumLines(); i++) {
            int faceIdMin = flat.lineInFaceBorder_min_request(i);
            int faceIdMax = flat.lineInFaceBorder_max_request(i);
            if (faceIdMin != faceIdMax) {
                int minPos = flat.getIFacePosition(faceIdMin);
                int maxPos = flat.getIFacePosition(faceIdMax);
                if (minPos % 2 == maxPos % 2) {
                    System.out.println("hierarchy_error|same_parity|"
                            + (i - 1) + "|"
                            + (faceIdMin - 1) + "|"
                            + (faceIdMax - 1));
                    return null;
                }

                int value;
                if (folded.getColor(i) == LineColor.RED_1) {
                    value = minPos % 2 == 1 ? HierarchyList.ABOVE_1 : HierarchyList.BELOW_0;
                } else {
                    value = minPos % 2 == 1 ? HierarchyList.BELOW_0 : HierarchyList.ABOVE_1;
                }
                hierarchyList.set(faceIdMin, faceIdMax, value);
            }
        }
        return hierarchyList;
    }

    private static int[] normalizedOraclePair(HierarchyList hierarchyList, int first, int second) {
        if (hierarchyList.get(first, second) == HierarchyList.BELOW_0) {
            return new int[] {second, first};
        }
        return new int[] {first, second};
    }

    private static boolean oracleSubfacesContainAll(
            SubFace[] subfaces,
            int first,
            int second,
            int third,
            int fourth) {
        for (int i = 1; i < subfaces.length; i++) {
            if (subfaces[i].contains(first, second, third, fourth)) {
                return true;
            }
        }
        return false;
    }

    private static SubFace[] reflectedReducedSubfaces(FoldedFigure_Worker worker) throws Exception {
        Field field = FoldedFigure_Worker.class.getDeclaredField("s1");
        field.setAccessible(true);
        return (SubFace[]) field.get(worker);
    }

    private static int subfaceOriginalIndex(SubFace[] subfaces, SubFace target) {
        for (int i = 1; i < subfaces.length; i++) {
            if (subfaces[i] == target) {
                return i - 1;
            }
        }
        return -1;
    }

    private static String oracleSubfaceFaceIds(SubFace subface) {
        StringBuilder output = new StringBuilder();
        for (int i = 1; i <= subface.getFaceIdCount(); i++) {
            if (i > 1) {
                output.append(",");
            }
            output.append(subface.getFaceId(i) - 1);
        }
        return output.toString();
    }

    private static String oracleFacePoints(origami.folding.element.Face face) {
        StringBuilder output = new StringBuilder();
        for (int i = 1; i <= face.getNumPoints(); i++) {
            if (i > 1) {
                output.append(",");
            }
            output.append(face.getPointId(i) - 1);
        }
        return output.toString();
    }

    private static String oracleFaceEdges(PointSet pointSet, origami.folding.element.Face face) {
        if (face.getNumPoints() == 0) {
            return "";
        }

        StringBuilder output = new StringBuilder();
        output.append(oracleFindEdge(
                pointSet,
                face.getPointId(1),
                face.getPointId(face.getNumPoints())) - 1);
        for (int i = 2; i <= face.getNumPoints(); i++) {
            output.append(",");
            output.append(oracleFindEdge(
                    pointSet,
                    face.getPointId(i),
                    face.getPointId(i - 1)) - 1);
        }
        return output.toString();
    }

    private static int oracleFindEdge(PointSet pointSet, int a, int b) {
        for (int i = 1; i <= pointSet.getNumLines(); i++) {
            if ((pointSet.getBegin(i) == a && pointSet.getEnd(i) == b)
                    || (pointSet.getBegin(i) == b && pointSet.getEnd(i) == a)) {
                return i;
            }
        }
        throw new IllegalStateException("edge in face not found");
    }

    private static Save fixtureSave() {
        Save save = SaveProvider.createInstance();
        save.setTitle("oracle");
        save.addLineSegment(new LineSegment(
                new Point(0.0, 0.0),
                new Point(10.0, 0.0),
                LineColor.BLUE_2).withCustomizedColor(new Color(1, 2, 3)));
        save.addCircle(new Circle(5.0, 5.0, 2.0, LineColor.MAGENTA_5));
        save.addAuxLineSegment(new LineSegment(
                new Point(1.0, 1.0),
                new Point(2.0, 2.0),
                LineColor.ORANGE_4));
        GridModel gridModel = new GridModel();
        gridModel.setBaseState(GridModel.State.HIDDEN);
        gridModel.setGridSize(24);
        save.setGridModel(gridModel);
        return save;
    }

    private static LineSegmentSet lineSegmentSet(String[] args, int offset, int count) {
        int expectedLength = offset + count * 5;
        if (args.length != expectedLength) {
            usage("line segment payload expects " + count + " entries of ax ay bx by color");
        }

        LineSegmentSet set = new LineSegmentSet();
        for (int index = 0; index < count; index++) {
            int base = offset + index * 5;
            set.addLine(
                    new Point(parse(args[base]), parse(args[base + 1])),
                    new Point(parse(args[base + 2]), parse(args[base + 3])),
                    LineColor.fromNumber(Integer.parseInt(args[base + 4])));
        }
        return set;
    }

    private static FoldLineSet foldLineSet(String[] args, int offset, int count) {
        int expectedLength = offset + count * 5;
        if (args.length != expectedLength) {
            usage("fold line payload expects " + count + " entries of ax ay bx by color");
        }

        FoldLineSet set = new FoldLineSet();
        for (int index = 0; index < count; index++) {
            int base = offset + index * 5;
            set.addLine(
                    new Point(parse(args[base]), parse(args[base + 1])),
                    new Point(parse(args[base + 2]), parse(args[base + 3])),
                    LineColor.fromNumber(Integer.parseInt(args[base + 4])));
        }
        return set;
    }

    private static LineSegment segment(String[] args, int offset) {
        return new LineSegment(
                new Point(parse(args[offset]), parse(args[offset + 1])),
                new Point(parse(args[offset + 2]), parse(args[offset + 3])),
                LineColor.fromNumber(Integer.parseInt(args[offset + 4])));
    }

    private static Circle circle(String[] args, int offset) {
        return new Circle(
                parse(args[offset]),
                parse(args[offset + 1]),
                parse(args[offset + 2]),
                LineColor.fromNumber(Integer.parseInt(args[offset + 3])));
    }

    private static void addLineSegmentLikeWorker(FoldLineSet set, LineSegment segment) {
        set.addLine(segment);
        int totalOld = set.getTotal();
        set.divideLineSegmentWithNewLines(totalOld - 1, totalOld);
    }

    private static void printSegmentResult(LineSegment result) {
        if (result == null) {
            System.out.println("result|null");
            return;
        }
        System.out.println("result|"
                + result.determineAX() + "|"
                + result.determineAY() + "|"
                + result.determineBX() + "|"
                + result.determineBY() + "|"
                + result.getColor().getNumber());
    }

    private static void printOperationFrame(
            OperationFrame frame,
            OperationFrameOracleMode mode,
            Point lastMousePos) {
        System.out.println("frame|"
                + frame.isActive() + "|"
                + mode.name() + "|"
                + frame.getP1().getX() + "|"
                + frame.getP1().getY() + "|"
                + frame.getP2().getX() + "|"
                + frame.getP2().getY() + "|"
                + frame.getP3().getX() + "|"
                + frame.getP3().getY() + "|"
                + frame.getP4().getX() + "|"
                + frame.getP4().getY() + "|"
                + lastMousePos.getX() + "|"
                + lastMousePos.getY());
    }

    private static void printVoronoiState(OracleVoronoiState state) {
        System.out.println("seeds|" + state.seedPoints.size());
        for (Point seed : state.seedPoints) {
            System.out.println("seed|" + seed.getX() + "|" + seed.getY());
        }
        System.out.println("voronoi|" + state.lineSegments.size());
        for (OracleVoronoiLineSegment line : state.lineSegments) {
            System.out.println("vline|"
                    + line.lineSegment.determineAX() + "|"
                    + line.lineSegment.determineAY() + "|"
                    + line.lineSegment.determineBX() + "|"
                    + line.lineSegment.determineBY() + "|"
                    + line.voronoiA + "|"
                    + line.voronoiB + "|"
                    + line.selected);
        }
    }

    private static void printTextState(List<Text> texts, OracleTextState state) {
        boolean hasStart = state.selectionStart != null;
        System.out.println("textstate|"
                + state.selected + "|"
                + state.isSelected + "|"
                + state.dirty + "|"
                + hasStart + "|"
                + (hasStart ? state.selectionStart.getX() : 0.0) + "|"
                + (hasStart ? state.selectionStart.getY() : 0.0));
        System.out.println("texts|" + texts.size());
        for (Text text : texts) {
            System.out.println("text|" + text.getX() + "|" + text.getY() + "|" + text.getText());
        }
    }

    private static Polygon polygon(String[] args, int offset, int count) {
        List<Point> points = new ArrayList<>();
        for (int index = 0; index < count; index++) {
            int base = offset + index * 2;
            points.add(new Point(parse(args[base]), parse(args[base + 1])));
        }
        return new Polygon(points);
    }

    private static Path2D path(String[] args, int offset, int count) {
        Path2D path = new Path2D.Double();
        if (count <= 0) {
            return path;
        }

        path.moveTo(parse(args[offset]), parse(args[offset + 1]));
        for (int index = 1; index < count; index++) {
            int base = offset + index * 2;
            path.lineTo(parse(args[base]), parse(args[base + 1]));
        }
        path.closePath();
        return path;
    }

    private static void applySelectedIndices(FoldLineSet set, String indices, int selected) {
        for (int index : parseIndices(indices)) {
            set.get(index + 1).setSelected(selected);
        }
    }

    private static List<Integer> parseIndices(String indices) {
        List<Integer> result = new ArrayList<>();
        if (indices.equals("-") || indices.isEmpty()) {
            return result;
        }

        for (String value : indices.split(",")) {
            if (!value.isEmpty()) {
                result.add(Integer.parseInt(value));
            }
        }
        return result;
    }

    private static void printLineSegmentSet(LineSegmentSet set) {
        System.out.println("lines|" + set.getNumLineSegments());
        for (int index = 0; index < set.getNumLineSegments(); index++) {
            LineSegment segment = set.get(index);
            System.out.println("line|"
                    + segment.determineAX() + "|"
                    + segment.determineAY() + "|"
                    + segment.determineBX() + "|"
                    + segment.determineBY() + "|"
                    + segment.getColor().getNumber());
        }
    }

    private static void printLineSegmentsList(Collection<LineSegment> segments) {
        System.out.println("lines|" + segments.size());
        for (LineSegment segment : segments) {
            System.out.println("line|"
                    + segment.determineAX() + "|"
                    + segment.determineAY() + "|"
                    + segment.determineBX() + "|"
                    + segment.determineBY() + "|"
                    + segment.getColor().getNumber());
        }
    }

    private static void printPointsList(List<Point> points) {
        System.out.println("points|" + points.size());
        for (Point point : points) {
            System.out.println("point|" + point.getX() + "|" + point.getY());
        }
    }

    private static void printFlatFoldabilityViolations(List<FlatFoldabilityViolation> violations) {
        System.out.println("violations|" + violations.size());
        for (FlatFoldabilityViolation violation : violations) {
            System.out.println("violation|"
                    + violation.getPoint().getX() + "|"
                    + violation.getPoint().getY() + "|"
                    + violation.getViolatedRule().name() + "|"
                    + violation.getColor().name());
            if (violation instanceof LittleBigLittleViolation littleBigLittleViolation) {
                LineSegment[] lineSegments = littleBigLittleViolation.getLineSegments();
                boolean[] violating = littleBigLittleViolation.getViolatingLBL();
                System.out.println("lbl|" + lineSegments.length);
                for (int i = 0; i < lineSegments.length; i++) {
                    LineSegment segment = lineSegments[i];
                    System.out.println("lblline|"
                            + segment.determineAX() + "|"
                            + segment.determineAY() + "|"
                            + segment.determineBX() + "|"
                            + segment.determineBY() + "|"
                            + segment.getColor().getNumber() + "|"
                            + violating[i]);
                }
            } else {
                System.out.println("lbl|0");
            }
        }
    }

    private static void printFoldLineSet(FoldLineSet set) {
        System.out.println("lines|" + set.getTotal());
        for (int index = 1; index <= set.getTotal(); index++) {
            LineSegment segment = set.get(index);
            System.out.println("line|"
                    + segment.determineAX() + "|"
                    + segment.determineAY() + "|"
                    + segment.determineBX() + "|"
                    + segment.determineBY() + "|"
                    + segment.getColor().getNumber());
        }
    }

    private static void printAuxLineSet(FoldLineSet set) {
        System.out.println("aux|" + set.getTotal());
        for (int index = 1; index <= set.getTotal(); index++) {
            LineSegment segment = set.get(index);
            System.out.println("auxline|"
                    + segment.determineAX() + "|"
                    + segment.determineAY() + "|"
                    + segment.determineBX() + "|"
                    + segment.determineBY() + "|"
                    + segment.getColor().getNumber());
        }
    }

    private static void printCircleSet(FoldLineSet set) {
        System.out.println("circles|" + set.getCircles().size());
        for (Circle circle : set.getCircles()) {
            System.out.println("circle|"
                    + circle.getX() + "|"
                    + circle.getY() + "|"
                    + circle.getR() + "|"
                    + circle.getColor().getNumber() + "|"
                    + circle.getCustomized() + "|"
                    + circle.getCustomizedColor().getRed() + "|"
                    + circle.getCustomizedColor().getGreen() + "|"
                    + circle.getCustomizedColor().getBlue());
        }
    }

    private static void printFoldLineSetWithCustomization(FoldLineSet set) {
        System.out.println("lines|" + set.getTotal());
        for (int index = 1; index <= set.getTotal(); index++) {
            LineSegment segment = set.get(index);
            System.out.println("line|"
                    + segment.determineAX() + "|"
                    + segment.determineAY() + "|"
                    + segment.determineBX() + "|"
                    + segment.determineBY() + "|"
                    + segment.getColor().getNumber() + "|"
                    + segment.getCustomized() + "|"
                    + segment.getCustomizedColor().getRed() + "|"
                    + segment.getCustomizedColor().getGreen() + "|"
                    + segment.getCustomizedColor().getBlue());
        }
    }

    private static void printFoldLineSetWithSelection(FoldLineSet set) {
        System.out.println("lines|" + set.getTotal());
        for (int index = 1; index <= set.getTotal(); index++) {
            LineSegment segment = set.get(index);
            System.out.println("line|"
                    + segment.determineAX() + "|"
                    + segment.determineAY() + "|"
                    + segment.determineBX() + "|"
                    + segment.determineBY() + "|"
                    + segment.getColor().getNumber() + "|"
                    + segment.getSelected());
        }
    }

    private static void printFoldLineSetDeleteSet(Set<Integer> toDelete) {
        System.out.print("delete");
        toDelete.stream().sorted().forEach(index -> System.out.print("|" + (index - 1)));
        System.out.println();
    }

    private static List<LineSegment> selectedFoldLines(FoldLineSet set, String indices) {
        List<LineSegment> lines = new ArrayList<>();
        if (indices.isEmpty()) {
            return lines;
        }
        for (String index : indices.split(",")) {
            lines.add(set.get(Integer.parseInt(index) + 1));
        }
        return lines;
    }

    private static OracleFixXform oracleFixXform(Collection<LineSegment> lines) {
        double allowedError = 0.001;
        double maxX = -Double.MAX_VALUE;
        double maxY = -Double.MAX_VALUE;
        double minX = Double.MAX_VALUE;
        double minY = Double.MAX_VALUE;
        for (var ls : lines) {
            minX = Math.min(minX, Math.min(ls.getA().getX(), ls.getB().getX()));
            maxX = Math.max(maxX, Math.max(ls.getA().getX(), ls.getB().getX()));
            minY = Math.min(minY, Math.min(ls.getA().getY(), ls.getB().getY()));
            maxY = Math.max(maxY, Math.max(ls.getA().getY(), ls.getB().getY()));
        }
        boolean isSquare = Math.abs(Math.abs(minY - maxY) - Math.abs(minX - maxX)) < allowedError;
        boolean inDefaultSquare = (minX > -(200 + allowedError)) &&
                (minY > -(200 + allowedError)) &&
                (maxX < (200 + allowedError)) &&
                (maxY < (200 + allowedError));
        double midX = minX + Math.abs(maxX - minX) / 2;
        double midY = minY + Math.abs(maxY - minY) / 2;
        double scale = 400 / Math.abs(maxX - minX);
        return new OracleFixXform(isSquare, inDefaultSquare, scale, midX, midY);
    }

    private static ArrayList<LineSegment> oracleDoXform(Collection<LineSegment> lines, OracleFixXform xform) {
        ArrayList<LineSegment> out = new ArrayList<>();
        for (var ls : lines) {
            var ls2 = ls.withCoordinates((ls.getA().getX() - xform.deltaX) * xform.scale,
                    (ls.getA().getY() - xform.deltaY) * xform.scale,
                    (ls.getB().getX() - xform.deltaX) * xform.scale,
                    (ls.getB().getY() - xform.deltaY) * xform.scale);
            if (xform.isSquare && !xform.inDefaultSquare) {
                out.add(ls2);
            } else {
                out.add(ls);
            }
        }
        return out;
    }

    private static ArrayList<Double> oracleUndoXform(ArrayList<Double> lines, OracleFixXform xform) {
        double allowedError = 0.000000000001;
        if (xform.isSquare && !xform.inDefaultSquare) {
            ArrayList<Double> out = new ArrayList<>();
            for (int i = 0; i < lines.size(); i += 4) {
                double pos = lines.get(i) / xform.scale + xform.deltaX;
                out.add(oracleUndoXformCalc(pos, allowedError));
                pos = lines.get(i + 1) / xform.scale + xform.deltaY;
                out.add(oracleUndoXformCalc(pos, allowedError));
                pos = lines.get(i + 2) / xform.scale + xform.deltaX;
                out.add(oracleUndoXformCalc(pos, allowedError));
                pos = lines.get(i + 3) / xform.scale + xform.deltaY;
                out.add(oracleUndoXformCalc(pos, allowedError));
            }
            return out;
        }
        return lines;
    }

    private static double oracleUndoXformCalc(double pos, double allowedError) {
        double close = (double) Math.round(pos);
        if (Math.abs(close - pos) < allowedError) {
            return close;
        }
        return pos;
    }

    private static OracleFixerResult oracleFix(ArrayList<Double> toFix, boolean useBp, boolean use22_5, double fixPrecision) {
        ArrayList<OracleFixerResult> results = new ArrayList<>();
        if (useBp) {
            results.add(oracleFixBp(toFix));
            if (results.get(0).numFixableLines > (toFix.size() / 4.0 * .9)) {
                return results.get(0);
            }
        }
        if (use22_5) {
            results.add(oracleFixWithData(toFix, fixPrecision / 100.0, oracleFixData22_5()));
        }

        long maxLines = 0;
        OracleFixerResult returnResult = new OracleFixerResult(0, 0, new ArrayList<>(), OracleFixerType.EMPTY);
        for (OracleFixerResult result : results) {
            if (result.numFixableLines > maxLines) {
                maxLines = result.numFixableLines;
                returnResult = result;
            }
        }
        return returnResult;
    }

    private static OracleFixerResult oracleFixBp(ArrayList<Double> toFix) {
        ArrayList<Double> outLines = new ArrayList<>();
        double allowedError = 0.00000000001;
        int gridSize = 0;
        double currentValue;
        double nearestInt;
        final double basePrecision = 0.0013;
        double precision = 0;
        int gridSizeSearch = 0;
        long numLinesFixedWithPrevBestGrid = 0;
        boolean endGridSearch = false;
        final float gridSearchEndPercent = .9f;
        final float necessaryImprovementGrid = 1.15f;
        boolean isLineFixed = false;
        long numFixableLines = 0;
        long numFixedLines = 0;

        for (int gridIteration = 1; gridIteration <= 16; gridIteration++) {
            numFixableLines = 0;
            switch (gridIteration) {
                case 1 -> gridSizeSearch = 1024;
                case 2 -> gridSizeSearch = 1536;
                case 3 -> gridSizeSearch = 1280;
                case 4 -> gridSizeSearch = 1792;
                case 5 -> gridSizeSearch = 1152;
                case 6 -> gridSizeSearch = 1408;
                case 7 -> gridSizeSearch = 1664;
                case 8 -> gridSizeSearch = 1920;
                case 9 -> gridSizeSearch = 1088;
                case 10 -> gridSizeSearch = 1216;
                case 11 -> gridSizeSearch = 1344;
                case 12 -> gridSizeSearch = 1472;
                case 13 -> gridSizeSearch = 1600;
                case 14 -> gridSizeSearch = 1728;
                case 15 -> gridSizeSearch = 1856;
                case 16 -> gridSizeSearch = 1984;
            }
            precision = (basePrecision * gridSizeSearch) / 200.0;

            for (int i = 0; i < toFix.size(); i++) {
                currentValue = toFix.get(i);
                if ((i % 4) == 0) {
                    isLineFixed = false;
                }
                currentValue = currentValue / 200 * gridSizeSearch;
                nearestInt = (double) Math.round(currentValue);
                if (Math.abs(currentValue - nearestInt) > precision) {
                    continue;
                }
                if (!isLineFixed) {
                    isLineFixed = true;
                    numFixableLines++;
                }
            }

            if (numFixableLines > (numLinesFixedWithPrevBestGrid) * necessaryImprovementGrid) {
                gridSize = gridSizeSearch;
                numLinesFixedWithPrevBestGrid = numFixableLines;
            }
            if (numFixableLines > ((toFix.size() / 4.0) * gridSearchEndPercent)) {
                endGridSearch = true;
            }
            isLineFixed = false;
            if (endGridSearch) {
                break;
            }
        }

        for (int i = 0; i < toFix.size(); i++) {
            currentValue = toFix.get(i);
            if ((i % 4) == 0) {
                isLineFixed = false;
            }
            currentValue = currentValue / 200 * gridSize;
            nearestInt = (double) Math.round(currentValue);
            if (Math.abs(currentValue - nearestInt) < precision) {
                if (Math.abs(currentValue - nearestInt) > allowedError) {
                    if (!isLineFixed) {
                        isLineFixed = true;
                        numFixedLines++;
                    }
                    currentValue = nearestInt;
                }
            }
            currentValue = currentValue * 200 / gridSize;
            outLines.add(currentValue);
        }

        return new OracleFixerResult(numFixedLines, numFixableLines, outLines, OracleFixerType.BP);
    }

    private static OracleFixerResult oracleFixWithData(ArrayList<Double> inLines, double precision, double[] fixData) {
        ArrayList<Double> outLines = new ArrayList<>();
        ArrayList<Double> prevFixedPositions = new ArrayList<>();
        double allowedError = 0.00000000001;
        double currentValue;
        boolean isNegative;
        boolean skipSlow;
        boolean isLineFixed = false;
        long numFixableLines = 0;
        long numFixedLines = 0;

        for (int i = 0; i < inLines.size(); i++) {
            currentValue = inLines.get(i);
            skipSlow = false;
            isNegative = false;
            if (((i % 4) == 0)) {
                isLineFixed = false;
            }
            if (currentValue < 0) {
                isNegative = true;
                currentValue *= -1;
            }
            for (Double prevFixedPosition : prevFixedPositions) {
                if (Math.abs(currentValue - prevFixedPosition) > precision) {
                    continue;
                }
                if (Math.abs(currentValue - prevFixedPosition) > allowedError) {
                    currentValue = prevFixedPosition;
                    if (!isLineFixed) {
                        isLineFixed = true;
                        numFixableLines++;
                        numFixedLines++;
                        skipSlow = true;
                        break;
                    }
                } else if (!isLineFixed) {
                    isLineFixed = true;
                    numFixableLines++;
                    break;
                }
            }
            if (!skipSlow) {
                for (double fixDatum : fixData) {
                    if (Math.abs(currentValue - fixDatum) > precision) {
                        continue;
                    }
                    if (Math.abs(currentValue - fixDatum) > allowedError) {
                        currentValue = fixDatum;
                        prevFixedPositions.add(fixDatum);
                        if (!isLineFixed) {
                            isLineFixed = true;
                            numFixableLines++;
                            numFixedLines++;
                            break;
                        }
                    } else if (!isLineFixed) {
                        isLineFixed = true;
                        numFixableLines++;
                        break;
                    }
                }
            }
            if (isNegative) {
                currentValue *= -1;
            }
            outLines.add(currentValue);
        }
        return new OracleFixerResult(numFixedLines, numFixableLines, outLines, OracleFixerType.PURE_22_5);
    }

    private static double[] oracleFixData22_5() {
        try (var stream = OrieditaGeometryOracle.class.getClassLoader().getResourceAsStream("fixData_22_5.bin")) {
            byte[] bytes = stream.readAllBytes();
            ByteBuffer byteBuffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
            DoubleBuffer db = byteBuffer.asDoubleBuffer();
            double[] fixData = new double[db.remaining()];
            db.get(fixData);
            return fixData;
        } catch (IOException | NullPointerException e) {
            throw new RuntimeException(e);
        }
    }

    private static void printSaveSummary(Save save) {
        System.out.println("title|" + nullToEmpty(save.getTitle()));
        System.out.println("lines|" + save.getLineSegments().size());
        for (LineSegment segment : save.getLineSegments()) {
            System.out.println("line|"
                    + segment.determineAX() + "|"
                    + segment.determineAY() + "|"
                    + segment.determineBX() + "|"
                    + segment.determineBY() + "|"
                    + segment.getColor().getNumber() + "|"
                    + segment.getActive().name() + "|"
                    + segment.getSelected() + "|"
                    + segment.getCustomized() + "|"
                    + segment.getCustomizedColor().getRed() + "|"
                    + segment.getCustomizedColor().getGreen() + "|"
                    + segment.getCustomizedColor().getBlue());
        }
        System.out.println("circles|" + save.getCircles().size());
        for (Circle circle : save.getCircles()) {
            System.out.println("circle|"
                    + circle.getX() + "|"
                    + circle.getY() + "|"
                    + circle.getR() + "|"
                    + circle.getColor().getNumber() + "|"
                    + circle.getCustomized() + "|"
                    + circle.getCustomizedColor().getRed() + "|"
                    + circle.getCustomizedColor().getGreen() + "|"
                    + circle.getCustomizedColor().getBlue());
        }
        System.out.println("aux|" + save.getAuxLineSegments().size());
        for (LineSegment segment : save.getAuxLineSegments()) {
            System.out.println("auxline|"
                    + segment.determineAX() + "|"
                    + segment.determineAY() + "|"
                    + segment.determineBX() + "|"
                    + segment.determineBY() + "|"
                    + segment.getColor().getNumber() + "|"
                    + segment.getActive().name() + "|"
                    + segment.getSelected() + "|"
                    + segment.getCustomized() + "|"
                    + segment.getCustomizedColor().getRed() + "|"
                    + segment.getCustomizedColor().getGreen() + "|"
                    + segment.getCustomizedColor().getBlue());
        }
        GridModel grid = save.getGridModel();
        if (grid == null) {
            System.out.println("grid|null");
        } else {
            System.out.println("grid|"
                    + grid.getIntervalGridSize() + "|"
                    + grid.getGridSize() + "|"
                    + grid.getGridXA() + "|"
                    + grid.getGridXB() + "|"
                    + grid.getGridXC() + "|"
                    + grid.getGridYA() + "|"
                    + grid.getGridYB() + "|"
                    + grid.getGridYC() + "|"
                    + grid.getGridAngle() + "|"
                    + grid.getBaseState().getState() + "|"
                    + grid.getVerticalScalePosition() + "|"
                    + grid.getHorizontalScalePosition() + "|"
                    + grid.getDrawDiagonalGridlines());
        }
    }

    private static String nullToEmpty(String value) {
        return value == null ? "" : value;
    }

    private static double parse(String value) {
        return Double.parseDouble(value);
    }

    private static List<Integer> parseIndexList(String value) {
        List<Integer> result = new ArrayList<>();
        if (value.equals("-") || value.isBlank()) {
            return result;
        }
        for (String part : value.split(",")) {
            if (!part.isBlank()) {
                result.add(Integer.parseInt(part));
            }
        }
        return result;
    }

    private static void usage(String message) {
        System.err.println(message);
        System.err.println("usage: OrieditaGeometryOracle intersection <strict|sweet> <default|precision> ax ay bx by cx cy dx dy");
        System.err.println("   or: OrieditaGeometryOracle intersect-divide <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle intersect-divide-pair <i> <j> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-divide-new-lines <originalEnd> <addedEnd> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-divide-fast <i> <j> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-delete-inside <l|lX> <selection ax ay bx by color> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-delete-line-vertex <index> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-delete-lines <indices> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-branch-trim <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-del-v <px> <py> <snapRadius> <vertexRadius> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-del-v-cc <px> <py> <snapRadius> <vertexRadius> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-del-v-pair <i> <j> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-del-v-all <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-del-v-all-cc <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-check1 <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-check2 <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-check3 <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-check4 <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle check-camv-task <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-fix1 <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-fix2 <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-fix-inaccurate <useBP> <use22_5> <precision> <indices> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-set-color <color> <indices> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-change-type <index> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-make-color <color> <indices> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-make-aux <indices> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-change-mv <indices> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-advance-type <index> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-alternate-mv <startColor> <guide ax ay bx by color> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-alternate-mv-crossing <startColor> <guide ax ay bx by color> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-select-lasso <select|unselect> <preselected indices> <vertexCount> [x y]... <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle operation-frame-sequence <selectionDistance> <active> <p1x> <p1y> <p2x> <p2y> <p3x> <p3y> <p4x> <p4y> <lineCount> [ax ay bx by color]... <circleCount> [cx cy r color]... <eventCount> [press|drag|release|reset x y]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-lengthen <current|same> <lineColor> <selectionDistance> <selection ax ay bx by color> <extensionX> <extensionY> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-parallel-draw <targetX> <targetY> <parallel ax ay bx by color> <destination ax ay bx by color> <color> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-parallel-width <selected ax ay bx by color> <width> <choice> <color> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-perpendicular-projection <targetX> <targetY> <base ax ay bx by color> <color> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-perpendicular-indicator <targetX> <targetY> <base ax ay bx by color> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-axiom5-indicator <targetX> <targetY> <target ax ay bx by color> <pivotX> <pivotY> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-axiom5-commit <indicator ax ay bx by color> <color> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-axiom5-destination <pivotX> <pivotY> <indicator1 ax ay bx by color> <indicator2 ax ay bx by color> <destination ax ay bx by color> <pointerX> <pointerY> <color> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-axiom7-indicator <targetX> <targetY> <target ax ay bx by color> <perpendicular ax ay bx by color> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-axiom7-commit <indicator ax ay bx by color> <color> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-axiom7-destination <indicator ax ay bx by color> <destination ax ay bx by color> <color> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-symmetric-draw <source ax ay bx by color> <mirror ax ay bx by color> <color> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-double-symmetric-draw <drag ax ay bx by color> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-continuous-symmetric-draw <startX> <startY> <throughX> <throughY> <color> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-inward <p1x> <p1y> <p2x> <p2y> <p3x> <p3y> <color> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-fishbone <drag ax ay bx by color> <gridWidth> <color> <selectionDistance> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-angle-restricted5 <anchorX> <anchorY> <pointerX> <pointerY> <divider> <angle1> <angle2> <angle3> <angle4> <angle5> <angle6> <selectionDistance> <color> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-angle-restricted3-candidates <startX> <startY> <endX> <endY> <divider> <angle1> <angle2> <angle3> <angle4> <angle5> <angle6>");
        System.err.println("   or: OrieditaGeometryOracle foldline-angle-restricted3-draw <pointerX> <pointerY> <endpointX> <endpointY> <selected ax ay bx by color> <selectionDistance> <color> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-angle-restricted-converging-candidates <segment ax ay bx by color> <divider> <angle1> <angle2> <angle3> <angle4> <angle5> <angle6>");
        System.err.println("   or: OrieditaGeometryOracle foldline-angle-restricted-converging-draw <segment ax ay bx by color> <convergeX> <convergeY> <color> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-angle-system-candidates <startX> <startY> <endX> <endY> <divider> <angle1> <angle2> <angle3> <angle4> <angle5> <angle6>");
        System.err.println("   or: OrieditaGeometryOracle foldline-angle-system-draw <releaseX> <releaseY> <selected ax ay bx by color> <destination ax ay bx by color> <color> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-make-vertex-flat-foldable-candidates <vertexX> <vertexY> <gridWidth> <color> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-make-vertex-flat-foldable-destination <vertexX> <vertexY> <candidate ax ay bx by color> <destination ax ay bx by color> <color> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-foldable-input-candidates <vertexX> <vertexY> <gridWidth> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-foldable-input-direct <input ax ay bx by color> <color> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-foldable-input-destination <input ax ay bx by color> <destination ax ay bx by color> <color> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-foldable-draw-mode <pointerX> <pointerY> <selectionDistance> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-foldable-draw-switch <pointerX> <pointerY> <memoX> <memoY> <selectionDistance>");
        System.err.println("   or: OrieditaGeometryOracle foldline-square-bisector-3p <p1x> <p1y> <p2x> <p2y> <p3x> <p3y> <destination ax ay bx by color> <color> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-square-bisector-2l-np <first ax ay bx by color> <second ax ay bx by color> <destination ax ay bx by color> <color> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-square-bisector-parallel-indicator <first ax ay bx by color> <second ax ay bx by color> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-square-bisector-parallel-commit <indicator ax ay bx by color> <color> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-square-bisector-parallel-between <indicator ax ay bx by color> <firstDestination ax ay bx by color> <secondDestination ax ay bx by color> <color> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-draw-crease <fold|aux> <segment ax ay bx by color> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-draw-symmetric <axis ax ay bx by color> <preselected> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-draw-point <index> <targetX> <targetY> <selectionDistance> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-circle-draw <centerX> <centerY> <radiusX> <radiusY>");
        System.err.println("   or: OrieditaGeometryOracle foldline-circle-draw-free <centerX> <centerY> <radiusX> <radiusY>");
        System.err.println("   or: OrieditaGeometryOracle foldline-circle-three-point <ax> <ay> <bx> <by> <cx> <cy>");
        System.err.println("   or: OrieditaGeometryOracle foldline-circle-separate <centerX> <centerY> <ax> <ay> <bx> <by>");
        System.err.println("   or: OrieditaGeometryOracle foldline-circle-concentric <circle x y r color> <ax> <ay> <bx> <by>");
        System.err.println("   or: OrieditaGeometryOracle foldline-circle-concentric-select <candidateIndex> <target x y r color> <ref1 x y r color> <ref2 x y r color>");
        System.err.println("   or: OrieditaGeometryOracle foldline-circle-concentric-two <circle1 x y r color> <circle2 x y r color>");
        System.err.println("   or: OrieditaGeometryOracle foldline-circle-invert-circle <subject x y r color> <inversion x y r color>");
        System.err.println("   or: OrieditaGeometryOracle foldline-circle-invert-line <segment ax ay bx by color> <inversion x y r color>");
        System.err.println("   or: OrieditaGeometryOracle foldline-circle-organize <circleCount> [x y r color]... <lineCount> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-circle-change-color <circleIndices> <auxLineIndices> <r> <g> <b> <circleCount> [x y r color]... <lineCount> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-circle-tangent-point <pointX> <pointY> <circle x y r color> <lineCount> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-circle-tangent-two <circle1 x y r color> <circle2 x y r color>");
        System.err.println("   or: OrieditaGeometryOracle foldline-regular-polygon <corners> <color> <p1x> <p1y> <p2x> <p2y> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-voronoi <selectionDistance> <color> <apply> <lineCount> [ax ay bx by color]... <circleCount> [cx cy r color]... <pointCount> [x y]...");
        System.err.println("   or: OrieditaGeometryOracle foldline-default-molecule <resourcePath> <color> <p1x> <p1y> <p2x> <p2y> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle flat-foldable-boundary-check <boundaryCount> [ax ay bx by color]... <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle text-sequence <selectedIndex|-1> <selected> <dirty> <textCount> [x y text]... <eventCount> [press|drag|delete x y | box x1 y1 x2 y2]...");
        System.err.println("   or: OrieditaGeometryOracle measure-length <ax> <ay> <bx> <by>");
        System.err.println("   or: OrieditaGeometryOracle measure-angle <ax> <ay> <centerX> <centerY> <bx> <by>");
        System.err.println("   or: OrieditaGeometryOracle custom-line-type <customType> <lineColor>");
        System.err.println("   or: OrieditaGeometryOracle orh-import-summary <path>");
        System.err.println("   or: OrieditaGeometryOracle orh-export-fixture");
        System.err.println("   or: OrieditaGeometryOracle obj-import-summary <path>");
        System.err.println("   or: OrieditaGeometryOracle dxf-export-fixture");
        System.err.println("   or: OrieditaGeometryOracle fold-topology-summary <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle wireframe-folding-summary <startingFace> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle split-subface-arrangement <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle two-colored-subface-arrangement <startingFace> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle two-colored-estimate-summary <startingFace> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle subface-configuration-summary <startingFace> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle initial-hierarchy-summary <startingFace> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle equivalence-candidates-summary <startingFace> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle additional-estimation-summary <startingFace> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle folding-estimate-summary <startingFace> <order> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle folding-estimate-sequence-summary <startingFace> <orderCount> [order]... <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle folding-estimate-specific-summary <startingFace> <objective> <initialOrder> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle folding-estimate-save-batch-summary <startingFace> <objective> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle folding-estimate-case-filename <filename> <discoveredCase>");
        System.err.println("   or: OrieditaGeometryOracle duplicate-estimation-order <displayStyle>");
        System.err.println("   or: OrieditaGeometryOracle chain-permutation-summary <digits> <guideCount> [upper lower]... <topCsv|-> <bottomCsv|-> <limit>");
        System.err.println("   or: OrieditaGeometryOracle chain-permutation-temp-summary <digits> <guideCount> [upper lower]... <topCsv|-> <bottomCsv|-> <stepsBeforeTemp> <tempUpper> <tempLower> <stepsAfterTemp> <limitAfterClear>");
        System.err.println("   or: OrieditaGeometryOracle subface-guide-permutation-summary <facesTotal> <faceCount> [faceId]... <relationCount> [upper lower]... <limit>");
        System.err.println("   or: OrieditaGeometryOracle subface-overlap-search-summary <facesTotal> <faceCount> [faceId]... <relationCount> [upper lower]... <tripleCount> [a b c d]... <quadCount> [a b c d]...");
        System.err.println("   or: OrieditaGeometryOracle subface-priority-summary <facesTotal> <subfaceCount> [faceCount faceIds...]... <relationCount> [upper lower]...");
        System.err.println("   or: OrieditaGeometryOracle worker-overlap-search-summary <facesTotal> <subfaceCount> [faceCount faceIds...]... <relationCount> [upper lower]... <tripleCount> [a b c d]... <quadCount> [a b c d]...");
        System.err.println("   or: OrieditaGeometryOracle worker-overlap-search-swap-summary <facesTotal> <subfaceCount> [faceCount faceIds...]... <relationCount> [upper lower]... <tripleCount> [a b c d]... <quadCount> [a b c d]...");
        System.err.println("   or: OrieditaGeometryOracle worker-overlap-ordered-summary <facesTotal> <subfaceCount> <validCount> <swap> [faceCount faceIds...]... <relationCount> [upper lower]... <tripleCount> [a b c d]... <quadCount> [a b c d]...");
        System.err.println("   or: OrieditaGeometryOracle worker-overlap-ordered-sequence-summary <facesTotal> <subfaceCount> <validCount> [faceCount faceIds...]... <relationCount> [upper lower]... <tripleCount> [a b c d]... <quadCount> [a b c d]... <actionCount> [search swap|next ss]...");
        System.err.println("   or: OrieditaGeometryOracle worker-overlap-from-segments-summary <startingFace> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle worker-overlap-from-segments-swap-summary <startingFace> <count> [ax ay bx by color]...");
        System.err.println("   or: OrieditaGeometryOracle subface-swapper-summary <subfaceCount> [swapCounter]... <actionCount> [visit|record|process|estimate value]...");
        System.err.println("   or: OrieditaGeometryOracle folded-render-paper-front simple-square");
        System.err.println("   or: OrieditaGeometryOracle folded-render-paper-back simple-square");
        System.err.println("   or: OrieditaGeometryOracle folded-render-paper-both simple-square");
        System.exit(2);
    }
}
