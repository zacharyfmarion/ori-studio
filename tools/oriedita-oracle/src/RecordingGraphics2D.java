import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Composite;
import java.awt.Font;
import java.awt.FontMetrics;
import java.awt.Graphics;
import java.awt.Graphics2D;
import java.awt.GraphicsConfiguration;
import java.awt.Image;
import java.awt.Paint;
import java.awt.Polygon;
import java.awt.Rectangle;
import java.awt.RenderingHints;
import java.awt.Shape;
import java.awt.Stroke;
import java.awt.TexturePaint;
import java.awt.GradientPaint;
import java.awt.font.FontRenderContext;
import java.awt.font.GlyphVector;
import java.awt.geom.AffineTransform;
import java.awt.geom.Ellipse2D;
import java.awt.geom.PathIterator;
import java.awt.image.BufferedImage;
import java.awt.image.BufferedImageOp;
import java.awt.image.ImageObserver;
import java.awt.image.RenderedImage;
import java.awt.image.renderable.RenderableImage;
import java.text.AttributedCharacterIterator;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

final class RecordingGraphics2D extends Graphics2D {
    private final Graphics2D delegate;
    private final List<String> records;
    private final AtomicInteger sequence;

    RecordingGraphics2D(int width, int height) {
        this((Graphics2D) new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB).getGraphics(),
                new ArrayList<>(),
                new AtomicInteger());
    }

    private RecordingGraphics2D(Graphics2D delegate, List<String> records, AtomicInteger sequence) {
        this.delegate = delegate;
        this.records = records;
        this.sequence = sequence;
    }

    List<String> records() {
        return List.copyOf(records);
    }

    @Override
    public void draw(Shape shape) {
        recordShape("stroke_path", shape);
        delegate.draw(shape);
    }

    @Override
    public void fill(Shape shape) {
        if (shape instanceof Ellipse2D ellipse) {
            recordEllipse("fill_ellipse", ellipse);
        } else {
            recordShape("fill_path", shape);
        }
        delegate.fill(shape);
    }

    @Override
    public void drawLine(int x1, int y1, int x2, int y2) {
        record("stroke_segment", points(x1, y1, x2, y2));
        delegate.drawLine(x1, y1, x2, y2);
    }

    @Override
    public void fillPolygon(int[] xPoints, int[] yPoints, int nPoints) {
        record("fill_polygon", polygon(xPoints, yPoints, nPoints));
        delegate.fillPolygon(xPoints, yPoints, nPoints);
    }

    @Override
    public void drawPolygon(int[] xPoints, int[] yPoints, int nPoints) {
        record("stroke_polygon", polygon(xPoints, yPoints, nPoints));
        delegate.drawPolygon(xPoints, yPoints, nPoints);
    }

    @Override
    public void fillRect(int x, int y, int width, int height) {
        record("fill_rect", rect(x, y, width, height));
        delegate.fillRect(x, y, width, height);
    }

    @Override
    public void drawRect(int x, int y, int width, int height) {
        record("stroke_rect", rect(x, y, width, height));
        delegate.drawRect(x, y, width, height);
    }

    @Override
    public void fillOval(int x, int y, int width, int height) {
        record("fill_ellipse", rect(x, y, width, height));
        delegate.fillOval(x, y, width, height);
    }

    @Override
    public void drawOval(int x, int y, int width, int height) {
        record("stroke_ellipse", rect(x, y, width, height));
        delegate.drawOval(x, y, width, height);
    }

    @Override
    public void drawString(String str, int x, int y) {
        record("text", escape(str) + "|" + fmt(x) + "|" + fmt(y));
        delegate.drawString(str, x, y);
    }

    @Override
    public void drawString(String str, float x, float y) {
        record("text", escape(str) + "|" + fmt(x) + "|" + fmt(y));
        delegate.drawString(str, x, y);
    }

    private void recordShape(String kind, Shape shape) {
        record(kind, path(shape));
    }

    private void recordEllipse(String kind, Ellipse2D ellipse) {
        record(kind, rect(
                ellipse.getX(),
                ellipse.getY(),
                ellipse.getWidth(),
                ellipse.getHeight()));
    }

    private void record(String kind, String payload) {
        records.add("primitive|"
                + sequence.getAndIncrement() + "|"
                + kind + "|"
                + paint(delegate.getPaint()) + "|"
                + stroke(delegate.getStroke()) + "|"
                + antialias() + "|"
                + payload);
    }

    private String antialias() {
        Object hint = delegate.getRenderingHint(RenderingHints.KEY_ANTIALIASING);
        if (RenderingHints.VALUE_ANTIALIAS_ON.equals(hint)) {
            return "aa_on";
        }
        if (RenderingHints.VALUE_ANTIALIAS_OFF.equals(hint)) {
            return "aa_off";
        }
        return "aa_default";
    }

    private static String paint(Paint paint) {
        if (paint instanceof Color color) {
            return "color|" + color(color);
        }
        if (paint instanceof GradientPaint gradient) {
            return "gradient|"
                    + fmt(gradient.getPoint1().getX()) + "|"
                    + fmt(gradient.getPoint1().getY()) + "|"
                    + color(gradient.getColor1()) + "|"
                    + fmt(gradient.getPoint2().getX()) + "|"
                    + fmt(gradient.getPoint2().getY()) + "|"
                    + color(gradient.getColor2()) + "|"
                    + gradient.isCyclic();
        }
        if (paint instanceof TexturePaint) {
            return "texture";
        }
        return paint == null ? "none" : "paint|" + escape(paint.getClass().getName());
    }

    private static String stroke(Stroke stroke) {
        if (stroke instanceof BasicStroke basic) {
            return "basic|"
                    + fmt(basic.getLineWidth()) + "|"
                    + basic.getEndCap() + "|"
                    + basic.getLineJoin() + "|"
                    + fmt(basic.getMiterLimit());
        }
        return stroke == null ? "none" : "stroke|" + escape(stroke.getClass().getName());
    }

    private static String color(Color color) {
        return color.getRed() + "|" + color.getGreen() + "|" + color.getBlue() + "|" + color.getAlpha();
    }

    private static String path(Shape shape) {
        PathIterator iterator = shape.getPathIterator(null);
        double[] coords = new double[6];
        StringBuilder out = new StringBuilder();
        while (!iterator.isDone()) {
            if (out.length() > 0) {
                out.append(";");
            }
            switch (iterator.currentSegment(coords)) {
                case PathIterator.SEG_MOVETO -> out.append("M|").append(fmt(coords[0])).append("|").append(fmt(coords[1]));
                case PathIterator.SEG_LINETO -> out.append("L|").append(fmt(coords[0])).append("|").append(fmt(coords[1]));
                case PathIterator.SEG_QUADTO -> out.append("Q|")
                        .append(fmt(coords[0])).append("|")
                        .append(fmt(coords[1])).append("|")
                        .append(fmt(coords[2])).append("|")
                        .append(fmt(coords[3]));
                case PathIterator.SEG_CUBICTO -> out.append("C|")
                        .append(fmt(coords[0])).append("|")
                        .append(fmt(coords[1])).append("|")
                        .append(fmt(coords[2])).append("|")
                        .append(fmt(coords[3])).append("|")
                        .append(fmt(coords[4])).append("|")
                        .append(fmt(coords[5]));
                case PathIterator.SEG_CLOSE -> out.append("Z");
                default -> throw new IllegalStateException("unknown path segment");
            }
            iterator.next();
        }
        return out.toString();
    }

    private static String polygon(int[] xPoints, int[] yPoints, int nPoints) {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < nPoints; i++) {
            if (i > 0) {
                out.append(";");
            }
            out.append(fmt(xPoints[i])).append("|").append(fmt(yPoints[i]));
        }
        return out.toString();
    }

    private static String points(double x1, double y1, double x2, double y2) {
        return fmt(x1) + "|" + fmt(y1) + "|" + fmt(x2) + "|" + fmt(y2);
    }

    private static String rect(double x, double y, double width, double height) {
        return fmt(x) + "|" + fmt(y) + "|" + fmt(width) + "|" + fmt(height);
    }

    private static String fmt(double value) {
        return String.format(Locale.ROOT, "%.9f", value);
    }

    private static String escape(String value) {
        return value
                .replace("\\", "\\\\")
                .replace("|", "\\|")
                .replace("\n", "\\n")
                .replace("\r", "\\r");
    }

    @Override
    public Graphics create() {
        return new RecordingGraphics2D((Graphics2D) delegate.create(), records, sequence);
    }

    @Override
    public void translate(int x, int y) {
        delegate.translate(x, y);
    }

    @Override
    public Color getColor() {
        return delegate.getColor();
    }

    @Override
    public void setColor(Color c) {
        delegate.setColor(c);
    }

    @Override
    public void setPaintMode() {
        delegate.setPaintMode();
    }

    @Override
    public void setXORMode(Color c1) {
        delegate.setXORMode(c1);
    }

    @Override
    public Font getFont() {
        return delegate.getFont();
    }

    @Override
    public void setFont(Font font) {
        delegate.setFont(font);
    }

    @Override
    public FontMetrics getFontMetrics(Font f) {
        return delegate.getFontMetrics(f);
    }

    @Override
    public Rectangle getClipBounds() {
        return delegate.getClipBounds();
    }

    @Override
    public void clipRect(int x, int y, int width, int height) {
        delegate.clipRect(x, y, width, height);
    }

    @Override
    public void setClip(int x, int y, int width, int height) {
        delegate.setClip(x, y, width, height);
    }

    @Override
    public Shape getClip() {
        return delegate.getClip();
    }

    @Override
    public void setClip(Shape clip) {
        delegate.setClip(clip);
    }

    @Override
    public void copyArea(int x, int y, int width, int height, int dx, int dy) {
        delegate.copyArea(x, y, width, height, dx, dy);
    }

    @Override
    public void clearRect(int x, int y, int width, int height) {
        delegate.clearRect(x, y, width, height);
    }

    @Override
    public void drawRoundRect(int x, int y, int width, int height, int arcWidth, int arcHeight) {
        delegate.drawRoundRect(x, y, width, height, arcWidth, arcHeight);
    }

    @Override
    public void fillRoundRect(int x, int y, int width, int height, int arcWidth, int arcHeight) {
        delegate.fillRoundRect(x, y, width, height, arcWidth, arcHeight);
    }

    @Override
    public void drawArc(int x, int y, int width, int height, int startAngle, int arcAngle) {
        delegate.drawArc(x, y, width, height, startAngle, arcAngle);
    }

    @Override
    public void fillArc(int x, int y, int width, int height, int startAngle, int arcAngle) {
        delegate.fillArc(x, y, width, height, startAngle, arcAngle);
    }

    @Override
    public void drawPolyline(int[] xPoints, int[] yPoints, int nPoints) {
        delegate.drawPolyline(xPoints, yPoints, nPoints);
    }

    @Override
    public boolean drawImage(Image img, int x, int y, ImageObserver observer) {
        return delegate.drawImage(img, x, y, observer);
    }

    @Override
    public boolean drawImage(Image img, int x, int y, int width, int height, ImageObserver observer) {
        return delegate.drawImage(img, x, y, width, height, observer);
    }

    @Override
    public boolean drawImage(Image img, int x, int y, Color bgcolor, ImageObserver observer) {
        return delegate.drawImage(img, x, y, bgcolor, observer);
    }

    @Override
    public boolean drawImage(Image img, int x, int y, int width, int height, Color bgcolor, ImageObserver observer) {
        return delegate.drawImage(img, x, y, width, height, bgcolor, observer);
    }

    @Override
    public boolean drawImage(Image img, int dx1, int dy1, int dx2, int dy2, int sx1, int sy1, int sx2, int sy2, ImageObserver observer) {
        return delegate.drawImage(img, dx1, dy1, dx2, dy2, sx1, sy1, sx2, sy2, observer);
    }

    @Override
    public boolean drawImage(Image img, int dx1, int dy1, int dx2, int dy2, int sx1, int sy1, int sx2, int sy2, Color bgcolor, ImageObserver observer) {
        return delegate.drawImage(img, dx1, dy1, dx2, dy2, sx1, sy1, sx2, sy2, bgcolor, observer);
    }

    @Override
    public void dispose() {
        delegate.dispose();
    }

    @Override
    public boolean drawImage(Image img, AffineTransform xform, ImageObserver obs) {
        return delegate.drawImage(img, xform, obs);
    }

    @Override
    public void drawImage(BufferedImage img, BufferedImageOp op, int x, int y) {
        delegate.drawImage(img, op, x, y);
    }

    @Override
    public void drawRenderedImage(RenderedImage img, AffineTransform xform) {
        delegate.drawRenderedImage(img, xform);
    }

    @Override
    public void drawRenderableImage(RenderableImage img, AffineTransform xform) {
        delegate.drawRenderableImage(img, xform);
    }

    @Override
    public void drawString(AttributedCharacterIterator iterator, int x, int y) {
        delegate.drawString(iterator, x, y);
    }

    @Override
    public void drawString(AttributedCharacterIterator iterator, float x, float y) {
        delegate.drawString(iterator, x, y);
    }

    @Override
    public void drawGlyphVector(GlyphVector g, float x, float y) {
        delegate.drawGlyphVector(g, x, y);
    }

    @Override
    public boolean hit(Rectangle rect, Shape s, boolean onStroke) {
        return delegate.hit(rect, s, onStroke);
    }

    @Override
    public GraphicsConfiguration getDeviceConfiguration() {
        return delegate.getDeviceConfiguration();
    }

    @Override
    public void setComposite(Composite comp) {
        delegate.setComposite(comp);
    }

    @Override
    public void setPaint(Paint paint) {
        delegate.setPaint(paint);
    }

    @Override
    public void setStroke(Stroke s) {
        delegate.setStroke(s);
    }

    @Override
    public void setRenderingHint(RenderingHints.Key hintKey, Object hintValue) {
        delegate.setRenderingHint(hintKey, hintValue);
    }

    @Override
    public Object getRenderingHint(RenderingHints.Key hintKey) {
        return delegate.getRenderingHint(hintKey);
    }

    @Override
    public void setRenderingHints(Map<?, ?> hints) {
        delegate.setRenderingHints(hints);
    }

    @Override
    public void addRenderingHints(Map<?, ?> hints) {
        delegate.addRenderingHints(hints);
    }

    @Override
    public RenderingHints getRenderingHints() {
        return delegate.getRenderingHints();
    }

    @Override
    public void translate(double tx, double ty) {
        delegate.translate(tx, ty);
    }

    @Override
    public void rotate(double theta) {
        delegate.rotate(theta);
    }

    @Override
    public void rotate(double theta, double x, double y) {
        delegate.rotate(theta, x, y);
    }

    @Override
    public void scale(double sx, double sy) {
        delegate.scale(sx, sy);
    }

    @Override
    public void shear(double shx, double shy) {
        delegate.shear(shx, shy);
    }

    @Override
    public void transform(AffineTransform tx) {
        delegate.transform(tx);
    }

    @Override
    public void setTransform(AffineTransform tx) {
        delegate.setTransform(tx);
    }

    @Override
    public AffineTransform getTransform() {
        return delegate.getTransform();
    }

    @Override
    public Paint getPaint() {
        return delegate.getPaint();
    }

    @Override
    public Composite getComposite() {
        return delegate.getComposite();
    }

    @Override
    public void setBackground(Color color) {
        delegate.setBackground(color);
    }

    @Override
    public Color getBackground() {
        return delegate.getBackground();
    }

    @Override
    public Stroke getStroke() {
        return delegate.getStroke();
    }

    @Override
    public void clip(Shape s) {
        delegate.clip(s);
    }

    @Override
    public FontRenderContext getFontRenderContext() {
        return delegate.getFontRenderContext();
    }
}
