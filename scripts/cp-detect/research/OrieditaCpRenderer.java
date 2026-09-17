// Evaluation-only adapter to the vendored Oriedita renderer. No Ori Studio
// rasterization code is used. Input is normalized CP text, one segment per row.
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import javax.imageio.ImageIO;
import oriedita.editor.Colors;
import oriedita.editor.canvas.LineStyle;
import oriedita.editor.drawing.tools.Camera;
import oriedita.editor.drawing.tools.DrawingUtil;
import origami.crease_pattern.element.LineColor;
import origami.crease_pattern.element.LineSegment;
import origami.crease_pattern.element.Point;

public class OrieditaCpRenderer {
    public static void main(String[] args) throws Exception {
        if (args.length != 9) {
            throw new IllegalArgumentException("INPUT.cp OUTPUT.png SIZE WIDTH POINT_SIZE AA STYLE ROUNDED DARK");
        }
        int size = Integer.parseInt(args[2]);
        float width = Float.parseFloat(args[3]);
        int points = Integer.parseInt(args[4]);
        boolean aa = Boolean.parseBoolean(args[5]);
        LineStyle style = LineStyle.valueOf(args[6]);
        boolean rounded = Boolean.parseBoolean(args[7]);
        Colors.update(Boolean.parseBoolean(args[8]));
        BufferedImage image = new BufferedImage(size, size, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = image.createGraphics();
        g.setColor(Colors.get(Color.white));
        g.fillRect(0, 0, size, size);
        // CanvasUI uses this hint and Java2D's default stroke normalization.
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING,
                aa ? RenderingHints.VALUE_ANTIALIAS_ON : RenderingHints.VALUE_ANTIALIAS_OFF);
        Camera camera = new Camera();
        double margin = size / 32.0;
        camera.setCameraZoomX(size - 2 * margin);
        camera.setCameraZoomY(size - 2 * margin);
        camera.setDisplayPosition(new Point(margin, margin));
        ArrayList<LineSegment> lines = new ArrayList<>();
        for (String row : Files.readAllLines(Path.of(args[0]))) {
            if (row.isBlank()) continue;
            String[] values = row.trim().split("\\s+");
            int color = Integer.parseInt(values[0]);
            LineColor label = switch (color) {
                case 1 -> LineColor.BLACK_0;
                case 2 -> LineColor.RED_1;
                case 3 -> LineColor.BLUE_2;
                case 4 -> LineColor.CYAN_3;
                default -> throw new IllegalArgumentException("Unsupported CP color " + color);
            };
            lines.add(new LineSegment(new Point(Double.parseDouble(values[1]), Double.parseDouble(values[2])),
                    new Point(Double.parseDouble(values[3]), Double.parseDouble(values[4])), label));
        }
        // Preserve CreasePattern_Worker_Impl's AUX, other/valley, mountain,
        // boundary draw order, including its actual marker and cap code.
        for (LineSegment line : lines) {
            if (line.getColor() == LineColor.CYAN_3)
                DrawingUtil.drawAuxLine(g, line, camera, width, points, rounded);
        }
        for (LineColor color : new LineColor[]{LineColor.BLUE_2, LineColor.RED_1, LineColor.BLACK_0}) {
            g.setColor(Colors.get(Color.black));
            for (LineSegment line : lines) {
                if (line.getColor() == color)
                    DrawingUtil.drawCpLine(g, line, camera, style, width, points, size, size, rounded);
            }
        }
        g.dispose();
        ImageIO.write(image, "png", Path.of(args[1]).toFile());
    }
}
