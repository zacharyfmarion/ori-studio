/**
 * What the Page pane's style control offers (D9): the two built-ins, the
 * export style from Settings, and each preset saved there. A built-in keeps
 * its id and resolved values. Settings styles are resolved when chosen and
 * kept with the diagram, so a printed diagram never depends on whose machine
 * opens it.
 *
 * The rule is a document's own paper style's, shared with a Fold sequence's
 * (`lib/paper/documentPaperStyle`); these are its Diagram names.
 */
export {
  EXPORT_STYLE_CHOICE,
  chosenDocumentPaperStyle as chosenDiagramStyle,
  documentPaperStyleChoices as diagramStyleChoices,
  type DocumentPaperStyleChoice as DiagramStyleChoice,
} from '../../lib/paper/documentPaperStyle';
