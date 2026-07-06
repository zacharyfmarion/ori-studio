package oriedita.editor.databinding;

import oriedita.editor.canvas.LineStyle;

import java.awt.Color;
import java.io.Serializable;

public class ApplicationModel implements Serializable {
    private boolean mouseWheelMovesCreasePattern = true;
    private boolean displayPointSpotlight = false;
    private boolean displayPointOffset = false;
    private boolean displayGridInputAssist = false;
    private boolean displayComments = true;
    private boolean displayCpLines = true;
    private boolean displayAuxLines = true;
    private boolean displayLiveAuxLines = true;
    private boolean displayMarkings = true;
    private boolean displayCreasePatternOnTop = false;
    private boolean displayFoldingProgress = false;
    private boolean displaySelfIntersection = false;
    private boolean displayNumbers = false;
    private int lineWidth = 1;
    private int pointSize = 1;
    private LineStyle lineStyle = LineStyle.COLOR;
    private boolean antiAlias = false;
    private int gridLineWidth = 1;
    private Color gridColor = new Color(230, 230, 230);
    private Color gridScaleColor = new Color(180, 200, 180);
    private boolean cpExportWarning = true;

    public void set(ApplicationModel applicationModel) {
        this.mouseWheelMovesCreasePattern = applicationModel.mouseWheelMovesCreasePattern;
        this.displayPointSpotlight = applicationModel.displayPointSpotlight;
        this.displayPointOffset = applicationModel.displayPointOffset;
        this.displayGridInputAssist = applicationModel.displayGridInputAssist;
        this.displayComments = applicationModel.displayComments;
        this.displayCpLines = applicationModel.displayCpLines;
        this.displayAuxLines = applicationModel.displayAuxLines;
        this.displayLiveAuxLines = applicationModel.displayLiveAuxLines;
        this.displayMarkings = applicationModel.displayMarkings;
        this.displayCreasePatternOnTop = applicationModel.displayCreasePatternOnTop;
        this.displayFoldingProgress = applicationModel.displayFoldingProgress;
        this.displaySelfIntersection = applicationModel.displaySelfIntersection;
        this.displayNumbers = applicationModel.displayNumbers;
        this.lineWidth = applicationModel.lineWidth;
        this.pointSize = applicationModel.pointSize;
        this.lineStyle = applicationModel.lineStyle;
        this.antiAlias = applicationModel.antiAlias;
        this.gridLineWidth = applicationModel.gridLineWidth;
        this.gridColor = applicationModel.gridColor;
        this.gridScaleColor = applicationModel.gridScaleColor;
        this.cpExportWarning = applicationModel.cpExportWarning;
    }

    public boolean getMouseWheelMovesCreasePattern() { return mouseWheelMovesCreasePattern; }
    public void setMouseWheelMovesCreasePattern(boolean value) { mouseWheelMovesCreasePattern = value; }
    public boolean getDisplayPointSpotlight() { return displayPointSpotlight; }
    public void setDisplayPointSpotlight(boolean value) { displayPointSpotlight = value; }
    public boolean getDisplayPointOffset() { return displayPointOffset; }
    public void setDisplayPointOffset(boolean value) { displayPointOffset = value; }
    public boolean getDisplayGridInputAssist() { return displayGridInputAssist; }
    public void setDisplayGridInputAssist(boolean value) { displayGridInputAssist = value; }
    public boolean getDisplayComments() { return displayComments; }
    public void setDisplayComments(boolean value) { displayComments = value; }
    public boolean getDisplayCpLines() { return displayCpLines; }
    public void setDisplayCpLines(boolean value) { displayCpLines = value; }
    public boolean getDisplayAuxLines() { return displayAuxLines; }
    public void setDisplayAuxLines(boolean value) { displayAuxLines = value; }
    public boolean getDisplayLiveAuxLines() { return displayLiveAuxLines; }
    public void setDisplayLiveAuxLines(boolean value) { displayLiveAuxLines = value; }
    public boolean getDisplayMarkings() { return displayMarkings; }
    public void setDisplayMarkings(boolean value) { displayMarkings = value; }
    public boolean getDisplayCreasePatternOnTop() { return displayCreasePatternOnTop; }
    public void setDisplayCreasePatternOnTop(boolean value) { displayCreasePatternOnTop = value; }
    public boolean getDisplayFoldingProgress() { return displayFoldingProgress; }
    public void setDisplayFoldingProgress(boolean value) { displayFoldingProgress = value; }
    public boolean getDisplaySelfIntersection() { return displaySelfIntersection; }
    public void setDisplaySelfIntersection(boolean value) { displaySelfIntersection = value; }
    public boolean getDisplayNumbers() { return displayNumbers; }
    public void setDisplayNumbers(boolean value) { displayNumbers = value; }
    public int getLineWidth() { return lineWidth; }
    public void setLineWidth(int value) { lineWidth = value; }
    public int getPointSize() { return pointSize; }
    public void setPointSize(int value) { pointSize = value; }
    public LineStyle getLineStyle() { return lineStyle; }
    public void setLineStyle(LineStyle value) { lineStyle = value; }
    public boolean getAntiAlias() { return antiAlias; }
    public void setAntiAlias(boolean value) { antiAlias = value; }
    public int getGridLineWidth() { return gridLineWidth; }
    public void setGridLineWidth(int value) { gridLineWidth = value; }
    public Color getGridColor() { return gridColor; }
    public void setGridColor(Color value) { gridColor = value; }
    public Color getGridScaleColor() { return gridScaleColor; }
    public void setGridScaleColor(Color value) { gridScaleColor = value; }
    public boolean getCpExportWarning() { return cpExportWarning; }
    public void setCpExportWarning(boolean value) { cpExportWarning = value; }
}
