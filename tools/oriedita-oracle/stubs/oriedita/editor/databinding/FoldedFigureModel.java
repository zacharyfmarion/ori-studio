package oriedita.editor.databinding;

import origami.folding.FoldedFigure;

import java.awt.Color;
import java.io.Serializable;

public class FoldedFigureModel implements Serializable {
    private Color frontColor = new Color(255, 255, 50);
    private Color backColor = new Color(233, 233, 233);
    private Color lineColor = Color.black;
    private double scale = 1.0;
    private double rotation = 0.0;
    private boolean antiAlias = true;
    private boolean displayShadows = false;
    private FoldedFigure.State state = FoldedFigure.State.FRONT_0;
    private int foldedCases = 1;
    private boolean findAnotherOverlapValid = false;
    private int transparentTransparency = 16;
    private boolean transparencyColor = false;

    public void set(FoldedFigureModel model) {
        frontColor = model.frontColor;
        backColor = model.backColor;
        lineColor = model.lineColor;
        scale = model.scale;
        rotation = model.rotation;
        antiAlias = model.antiAlias;
        displayShadows = model.displayShadows;
        state = model.state;
        foldedCases = model.foldedCases;
        findAnotherOverlapValid = model.findAnotherOverlapValid;
        transparentTransparency = model.transparentTransparency;
        transparencyColor = model.transparencyColor;
    }

    public Color getFrontColor() { return frontColor; }
    public void setFrontColor(Color value) { frontColor = value; }
    public Color getBackColor() { return backColor; }
    public void setBackColor(Color value) { backColor = value; }
    public Color getLineColor() { return lineColor; }
    public void setLineColor(Color value) { lineColor = value; }
    public double getScale() { return scale; }
    public void setScale(double value) { scale = value; }
    public double getRotation() { return rotation; }
    public void setRotation(double value) { rotation = value; }
    public boolean getAntiAlias() { return antiAlias; }
    public void setAntiAlias(boolean value) { antiAlias = value; }
    public boolean getDisplayShadows() { return displayShadows; }
    public void setDisplayShadows(boolean value) { displayShadows = value; }
    public FoldedFigure.State getState() { return state; }
    public void setState(FoldedFigure.State value) { state = value; }
    public int getFoldedCases() { return foldedCases; }
    public void setFoldedCases(int value) { foldedCases = value; }
    public boolean isFindAnotherOverlapValid() { return findAnotherOverlapValid; }
    public void setFindAnotherOverlapValid(boolean value) { findAnotherOverlapValid = value; }
    public int getTransparentTransparency() { return transparentTransparency; }
    public void setTransparentTransparency(int value) { transparentTransparency = value; }
    public boolean isTransparencyColor() { return transparencyColor; }
    public void setTransparencyColor(boolean value) { transparencyColor = value; }
}
