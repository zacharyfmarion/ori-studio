import oriedita.editor.FrameProvider;
import oriedita.editor.databinding.GridModel;
import oriedita.editor.export.CpImporter;
import oriedita.editor.export.FoldImporter;
import oriedita.editor.export.OriImporter;
import oriedita.editor.save.Save;
import origami.crease_pattern.element.Circle;
import origami.crease_pattern.element.LineSegment;

import java.io.File;

public class OrieditaNativeIoOracle {
    private static final FrameProvider NO_FRAME = () -> null;

    public static void main(String[] args) throws Exception {
        if (args.length == 0) {
            usage("missing command");
        }

        switch (args[0]) {
            case "ori-import-summary" -> oriImportSummary(args);
            case "fold-import-summary" -> foldImportSummary(args);
            case "cp-import-summary" -> cpImportSummary(args);
            default -> usage("unknown command: " + args[0]);
        }
    }

    private static void cpImportSummary(String[] args) throws Exception {
        if (args.length != 2) {
            usage("cp-import-summary expects a file path");
        }

        printSaveSummary(new CpImporter().doImport(new File(args[1])));
    }

    private static void oriImportSummary(String[] args) throws Exception {
        if (args.length != 2) {
            usage("ori-import-summary expects a file path");
        }

        Save save = new OriImporter(NO_FRAME, false).doImport(new File(args[1]));
        if (save == null) {
            usage("ori-import-summary refused to import file");
        }
        printSaveSummary(save);
    }

    private static void foldImportSummary(String[] args) throws Exception {
        if (args.length != 2) {
            usage("fold-import-summary expects a file path");
        }

        printSaveSummary(new FoldImporter().doImport(new File(args[1])));
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

    private static void usage(String message) {
        System.err.println(message);
        System.err.println("usage: OrieditaNativeIoOracle ori-import-summary <path>");
        System.err.println("   or: OrieditaNativeIoOracle fold-import-summary <path>");
        System.err.println("   or: OrieditaNativeIoOracle cp-import-summary <path>");
        System.exit(2);
    }
}
