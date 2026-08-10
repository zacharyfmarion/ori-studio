package oriedita.editor.handler;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import oriedita.editor.canvas.MouseMode;
import oriedita.editor.drawing.tools.Camera;
import oriedita.editor.drawing.tools.DrawingUtil;
import oriedita.editor.handler.step.StepMouseHandler;
import oriedita.editor.handler.step.ObjCoordStepNode;
import origami.crease_pattern.OritaCalc;
import origami.crease_pattern.element.Circle;
import origami.crease_pattern.element.LineColor;
import origami.crease_pattern.element.LineSegment;
import origami.crease_pattern.element.Point;

import java.awt.Graphics2D;
import java.util.ArrayList;
import java.util.List;

enum CircleDrawApolloniusStep {
    SELECT_1,
    SELECT_2,
    SELECT_3,
    SELECT_RESULT,
}

@ApplicationScoped
@Handles(MouseMode.CIRCLE_DRAW_APOLLONIUS_108)
public class MouseHandlerCircleDrawApollonius extends StepMouseHandler<CircleDrawApolloniusStep> {
    private Point p1,p2,p3;
    private LineSegment l1, l2, l3;
    private Circle k1, k2, k3;
    private List<Circle> indicators;
    private Circle result;



    @Inject
    public MouseHandlerCircleDrawApollonius() {
        super(CircleDrawApolloniusStep.SELECT_1);
        steps.addNode(ObjCoordStepNode.createNode_MD_R(CircleDrawApolloniusStep.SELECT_1,
                this::move_drag_select_1,
                this::release_select_1));
        steps.addNode(ObjCoordStepNode.createNode_MD_R(CircleDrawApolloniusStep.SELECT_2,
                this::move_drag_select_2,
                this::release_select_2));
        steps.addNode(ObjCoordStepNode.createNode_MD_R(CircleDrawApolloniusStep.SELECT_3,
                this::move_drag_select_3,
                this::release_select_3));
        steps.addNode(ObjCoordStepNode.createNode_MD_R(CircleDrawApolloniusStep.SELECT_RESULT,
                this::move_drag_select_result,
                this::release_select_result));
    }

    @Override
    public void drawPreview(Graphics2D g2, Camera camera, DrawingSettings settings) {
        super.drawPreview(g2, camera, settings);

        for (Circle indicator : indicators)
            DrawingUtil.drawCircleStep(g2, indicator, camera);

        DrawingUtil.drawCircleStep(g2, k1, camera);
        DrawingUtil.drawCircleStep(g2, k2, camera);
        DrawingUtil.drawCircleStep(g2, k3, camera);
        DrawingUtil.drawCircleStep(g2, result, camera);

        DrawingUtil.drawLineStep(g2, l1, camera, settings.getLineWidth());
        DrawingUtil.drawLineStep(g2, l2, camera, settings.getLineWidth());
        DrawingUtil.drawLineStep(g2, l3, camera, settings.getLineWidth());

        DrawingUtil.drawStepVertex(g2, p1, LineColor.GREEN_6, camera);
        DrawingUtil.drawStepVertex(g2, p2, LineColor.GREEN_6, camera);
        DrawingUtil.drawStepVertex(g2, p3, LineColor.GREEN_6, camera);
    }

    @Override
    public void reset() {
        resetStep();
        indicators = new ArrayList<>();
        p1 = null;
        p2 = null;
        p3 = null;

        l1 = null;
        l2 = null;
        l3 = null;

        k1 = null;
        k2 = null;
        k3 = null;
        result = null;
    }

    // Select first element
    private void move_drag_select_1(Point p) {
        Circle tmpCircle = d.getClosestCircleMidpoint(p);
        if (OritaCalc.distance_circumference(p, tmpCircle) < d.getSelectionDistance()) {
            k1 = new Circle(tmpCircle);
            k1.setColor(LineColor.GREEN_6);
        } else
            k1 = null;

        LineSegment tmpSegment = d.getClosestLineSegment(p);
        if (OritaCalc.determineLineSegmentDistance(p, tmpSegment) < d.getSelectionDistance()) {
            l1 = new LineSegment(tmpSegment, LineColor.GREEN_6);
            k1 = null;
        } else
            l1 = null;

        // The solver uses 0 radius circles as points, p1-3 are only used for display
        if (p.distance(d.getClosestPoint(p)) < d.getSelectionDistance()) {
            p1 = d.getClosestPoint(p);
            k1 = new Circle(p1.getX(), p1.getY(), 0, LineColor.CYAN_3);
            l1 = null;
        } else
            p1 = null;
    }

    private CircleDrawApolloniusStep release_select_1(Point p) {
        if (p1 == null && k1 == null && l1 == null)
            return CircleDrawApolloniusStep.SELECT_1;
        return CircleDrawApolloniusStep.SELECT_2;
    }

    // Select second element
    private void move_drag_select_2(Point p) {
        Circle tmpCircle = d.getClosestCircleMidpoint(p);
        if (OritaCalc.distance_circumference(p, tmpCircle) < d.getSelectionDistance()) {
            k2 = new Circle(tmpCircle);
            k2.setColor(LineColor.GREEN_6);
        } else
            k2 = null;

        LineSegment tmpSegment = d.getClosestLineSegment(p);
        if (OritaCalc.determineLineSegmentDistance(p, tmpSegment) < d.getSelectionDistance()) {
            l2 = new LineSegment(tmpSegment, LineColor.GREEN_6);
            k2 = null;
        } else
            l2 = null;

        // The solver uses 0 radius circles as points, p1-3 are only used for display
        if (p.distance(d.getClosestPoint(p)) < d.getSelectionDistance()) {
            p2 = d.getClosestPoint(p);
            k2 = new Circle(p2.getX(), p2.getY(), 0, LineColor.CYAN_3);
            l2 = null;
        } else
            p2 = null;
    }

    private CircleDrawApolloniusStep release_select_2(Point p) {
        if (p2 == null && k2 == null && l2 == null)
            return CircleDrawApolloniusStep.SELECT_2;
        return CircleDrawApolloniusStep.SELECT_3;
    }

    // Select second element
    private void move_drag_select_3(Point p) {
        Circle tmpCircle = d.getClosestCircleMidpoint(p);
        if (OritaCalc.distance_circumference(p, tmpCircle) < d.getSelectionDistance()) {
            k3 = new Circle(tmpCircle);
            k3.setColor(LineColor.GREEN_6);
        } else
            k3 = null;

        LineSegment tmpSegment = d.getClosestLineSegment(p);
        if (OritaCalc.determineLineSegmentDistance(p, tmpSegment) < d.getSelectionDistance()) {
            l3 = new LineSegment(tmpSegment, LineColor.GREEN_6);
            k3 = null;
        } else
            l3 = null;

        // The solver uses 0 radius circles as points, p1-3 are only used for display
        if (p.distance(d.getClosestPoint(p)) < d.getSelectionDistance()) {
            p3 = d.getClosestPoint(p);
            k3 = new Circle(p3.getX(), p3.getY(), 0, LineColor.CYAN_3);
            l3 = null;
        } else
            p3 = null;
    }

    private CircleDrawApolloniusStep release_select_3(Point p) {
        if (p3 == null && k3 == null && l3 == null)
            return CircleDrawApolloniusStep.SELECT_3;

        process_apollonius();

        if(indicators.size() > 1)
            return CircleDrawApolloniusStep.SELECT_RESULT;
        else if(indicators.size() == 1) {
            indicators.get(0).setColor(LineColor.CYAN_3);
            d.addCircle(indicators.get(0));
            d.record();
            reset();
            return CircleDrawApolloniusStep.SELECT_1;
        }
        else {
            reset();
            return CircleDrawApolloniusStep.SELECT_1;
        }
    }

    // Select indicator
    private void move_drag_select_result(Point p) {
        double minDist = 100000.0;
        for (Circle indicator : indicators) {
            double dist = OritaCalc.distance_circumference(p, indicator);
            if (dist < minDist) {
                minDist = dist;
                if (dist < d.getSelectionDistance()) {
                    result = new Circle(indicator);
                    result.setColor(LineColor.ORANGE_4);
                } else
                    result = null;
            }
        }
    }

    private CircleDrawApolloniusStep release_select_result(Point p) {
        if (result == null)
            return CircleDrawApolloniusStep.SELECT_RESULT;

        result.setColor(LineColor.CYAN_3);
        d.addCircle(result);
        d.record();
        reset();
        return CircleDrawApolloniusStep.SELECT_1;
    }

    private void process_apollonius() {
        int numC = ((k1 !=null) ? 1:0) + ((k2 !=null) ? 1:0) + ((k3 !=null) ? 1:0);

        // Reshuffle to make sure they are populated from 1 to 3.
        // The selection process can e.g. leave l1 empty but have l2 populated
        if(l1==null && l3!=null) l1 = l3;
        if(l1==null && l2!=null) l1 = l2;
        if(l2==null && l3!=null) l2 = l3;

        if(k1==null && k3!=null) k1 = k3;
        if(k1==null && k2!=null) k1 = k2;
        if(k2==null && k3!=null) k2 = k3;

        // Points are represented by circles with radius 0, so 6/10 variants are redundant
        if(numC==3)  process_apollonius_CCC();
        if(numC==2)  process_apollonius_CCL();
        if(numC==1)  process_apollonius_CLL();
        if(numC==0)  process_apollonius_LLL();
    }

    private void process_apollonius_CCC() {
        final double EPS = 1e-6;
        final double MIN_R = 1e-3;
        final double MAX_R = 1e6;

        int[] signs = {-1, 1};

        for (int s1 : signs) {
            for (int s2 : signs) {
                for (int s3 : signs) {

                    double[][] lin = new double[2][4];
                    lin[0] = calc_coefficients_from_2_circles(k1, s1, k2, s2);
                    lin[1] = calc_coefficients_from_2_circles(k2, s2, k3, s3);

                    Circle[] sols = solve_one_or_more_circles(lin, s1);

                    for (Circle c : sols) {
                        if (c == null)
                            continue;

                        if (c.getR() < MIN_R || c.getR() > MAX_R)
                            continue;

                        if (is_valid_circle(c, indicators, EPS*10)) {
                            indicators.add(c);
                        }
                    }
                }
            }
        }
    }

    private void process_apollonius_CCL() {
        final double EPS = 1e-6;
        final double MIN_R = 1e-3;
        final double MAX_R = 1e6;

        int[] signs = {-1, 1};

        for (int s1 : signs) {
            for (int s2 : signs) {
                for (int s3 : signs) {

                    double[][] lin = new double[2][4];
                    lin[0] = calc_coefficients_from_2_circles(k1, s1, k2, s2);
                    lin[1] = calc_coefficients_from_line(l1, s3);

                    Circle[] sols = solve_one_or_more_circles(lin, s1);

                    for (Circle c : sols) {
                        if (c == null)
                            continue;

                        if (c.getR() < MIN_R || c.getR() > MAX_R)
                            continue;

                        if (is_valid_circle(c, indicators, EPS*10)) {
                            indicators.add(c);
                        }
                    }
                }
            }
        }
    }

    private void process_apollonius_CLL() {
        final double EPS = 1e-6;
        final double MIN_R = 1e-3;
        final double MAX_R = 1e6;

        int[] signs = {-1, 1};

        for (int s1 : signs) {
            for (int s2 : signs) {
                for (int s3 : signs) {
                    double[][] lin = new double[2][4];
                    lin[0] = calc_coefficients_from_line(l1, s2);
                    lin[1] = calc_coefficients_from_line(l2, s3);

                    Circle[] sols = solve_one_or_more_circles(lin, s1);

                    for (Circle c : sols) {
                        if (c == null)
                            continue;

                        if (c.getR() < MIN_R || c.getR() > MAX_R)
                            continue;

                        if (is_valid_circle(c, indicators, EPS*10)) {
                            indicators.add(c);
                        }
                    }
                }
            }
        }
    }

    private void process_apollonius_LLL() {
        final double EPS = 1e-6;
        final double MIN_R = 1e-3;
        final double MAX_R = 1e6;

        // Catch 3 parallel lines early
        if(1-Math.abs(dot(l1, l2)) < EPS && 1-Math.abs(dot(l2, l3)) < EPS)
            return;

        int[] signs = {-1, 1};

        for (int s1 : signs) {
            for (int s2 : signs) {
                for (int s3 : signs) {

                    Circle c = solve_LLL(s1, s2, s3);
                    if (c == null)
                        continue;

                    if (c.getR() < MIN_R || c.getR() > MAX_R)
                        continue;

                    if (is_valid_circle(c, indicators, EPS)) {
                        indicators.add(c);
                    }
                }
            }
        }
    }

    private Circle solve_LLL(int s1, int s2, int s3) {
        double[][] lin = new double[3][4];

        lin[0] = calc_coefficients_from_line(l1, s1);
        lin[1] = calc_coefficients_from_line(l2, s2);
        lin[2] = calc_coefficients_from_line(l3, s3);

        double det0 =
                lin[0][1]*lin[1][2]*lin[2][3] +
                        lin[0][2]*lin[1][3]*lin[2][1] +
                        lin[0][3]*lin[1][1]*lin[2][2] -
                        lin[2][1]*lin[1][2]*lin[0][3] -
                        lin[2][2]*lin[1][3]*lin[0][1] -
                        lin[2][3]*lin[1][1]*lin[0][2];

        if (Math.abs(det0) < 1e-9)
            return null;

        double detX =
                lin[0][0]*lin[1][2]*lin[2][3] +
                        lin[0][2]*lin[1][3]*lin[2][0] +
                        lin[0][3]*lin[1][0]*lin[2][2] -
                        lin[2][0]*lin[1][2]*lin[0][3] -
                        lin[2][2]*lin[1][3]*lin[0][0] -
                        lin[2][3]*lin[1][0]*lin[0][2];

        double detY =
                lin[0][1]*lin[1][0]*lin[2][3] +
                        lin[0][0]*lin[1][3]*lin[2][1] +
                        lin[0][3]*lin[1][1]*lin[2][0] -
                        lin[2][1]*lin[1][0]*lin[0][3] -
                        lin[2][0]*lin[1][3]*lin[0][1] -
                        lin[2][3]*lin[1][1]*lin[0][0];

        double detR =
                lin[0][1]*lin[1][2]*lin[2][0] +
                        lin[0][2]*lin[1][0]*lin[2][1] +
                        lin[0][0]*lin[1][1]*lin[2][2] -
                        lin[2][1]*lin[1][2]*lin[0][0] -
                        lin[2][2]*lin[1][0]*lin[0][1] -
                        lin[2][0]*lin[1][1]*lin[0][2];

        double x = detX / det0;
        double y = detY / det0;
        double r = detR / det0;


        return new Circle(x, y, Math.abs(r), LineColor.PURPLE_8);
    }

    private Circle[] solve_one_or_more_circles(double[][] lin, int s1) {
        double[][] cd = solve_2_linear_equations_with_3_unknown(lin);

        double c1 = cd[0][0], d1 = cd[0][1];
        double c2 = cd[1][0], d2 = cd[1][1];

        double e1 = d1 - k1.getX();
        double e2 = d2 - k1.getY();

        double kR = k1.getR();

        double denom = 1 - c1*c1 - c2*c2;
        double discr = calc_discriminant(c1, c2, s1, kR, e1, e2);

        double root = Math.sqrt(discr);
        double h = kR * s1 + c1*e1 + c2*e2;

        double r1 = (h + root) / denom;
        double r2 = (h - root) / denom;

        Circle[] result = new Circle[2];

        double x = c1 * r1 + d1;
        double y = c2 * r1 + d2;
        result[0] = new Circle(x, y, Math.abs(r1), LineColor.PURPLE_8);

        x = c1 * r2 + d1;
        y = c2 * r2 + d2;
        result[1] = new Circle(x, y, Math.abs(r2), LineColor.PURPLE_8);

        return result;
    }

    private double[] calc_coefficients_from_line(LineSegment g, int s) {
        double x1 = g.getA().getX();
        double y1 = g.getA().getY();
        double x2 = g.getB().getX();
        double y2 = g.getB().getY();

        double dx = x2 - x1;
        double dy = y2 - y1;

        double r0 = dy * x1 - dx * y1;
        double r1 = dy;
        double r2 = -dx;
        double r3 = s * g.determineLength();

        return new double[]{r0, r1, r2, r3};
    }

    private double[] calc_coefficients_from_2_circles(Circle k1, int s1, Circle k2, int s2) {
        double x1 = k1.getX(), y1 = k1.getY(), r1 = k1.getR();
        double x2 = k2.getX(), y2 = k2.getY(), r2 = k2.getR();

        double co1 = Math.pow(x2,2) - Math.pow(x1,2) + Math.pow(y2,2) - Math.pow(y1,2) + Math.pow(r1,2) - Math.pow(r2,2);
        double co2 = 2 * (x2 - x1);
        double co3 = 2 * (y2 - y1);
        double co4 = 2 * (s1*r1 - s2*r2);

        return new double[]{co1, co2, co3, co4};
    }

    private double calc_discriminant(double c1, double c2, double s1, double kR, double e1, double e2) {
        return (c1*c1 + c2*c2) * kR * kR +
                2 * (c1*e1 + c2*e2) * kR * s1 +
                (1 - c1*c1) * e2 * e2 +
                (1 - c2*c2) * e1 * e1 +
                2 * c1 * c2 * e1 * e2;
    }

    // Solve system of linear equations with 2 functions and 3 unknowns
    private double[][] solve_2_linear_equations_with_3_unknown(double[][] e) {
        // Numerator
        double det0 = e[0][1]*e[1][2] - e[1][1]*e[0][2];

        if (Math.abs(det0) < 1e-9)
            return new double[][]{{0,0},{0,0}}; // degenerate (parallel lines)

        // Denominators
        double det1 = e[1][3]*e[0][2] - e[0][3]*e[1][2];
        double det2 = e[0][0]*e[1][2] - e[1][0]*e[0][2];
        double det3 = e[1][1]*e[0][3] - e[0][1]*e[1][3];
        double det4 = e[0][1]*e[1][0] - e[1][1]*e[0][0];

        return new double[][]{{det1/det0, det2/det0}, {det3/det0, det4/det0}};
    }

    private double dot(LineSegment l1, LineSegment l2) {
        double l1_dx = l1.determineDeltaX()/l1.determineLength();
        double l1_dy = l1.determineDeltaY()/l1.determineLength();
        double l2_dx = l2.determineDeltaX()/l2.determineLength();
        double l2_dy = l2.determineDeltaY()/l2.determineLength();

        return  l1_dx*l2_dx + l1_dy*l2_dy;
    }

    // true for valid circle
    private boolean is_valid_circle(Circle c, List<Circle> list, double eps) {
        for (Circle other : list) {
            if(!is_valid_circle_helper(c, other, eps))
                return false;
        }
        if(k1!= null)
            if(!is_valid_circle_helper(c, k1, eps))
                return false;
        if(k2!= null)
            if(!is_valid_circle_helper(c, k2, eps))
                return false;
        if(k3!= null)
            return is_valid_circle_helper(c, k3, eps);

        return true;
    }

    // true for valid circle
    private boolean is_valid_circle_helper(Circle c, Circle other, double eps) {
        double dr = c.getR() - other.getR();
        return !((c.determineCenter().distance(other.determineCenter()) < eps) && (Math.abs(dr) < eps));
    }
}
