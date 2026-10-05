import { isMac, keyText, SHORTCUTS } from '../lib/editor-keys';
import EditorDialog from './EditorDialog';

export default function EditorHelpDialog({
  onClose,
  onAccount,
}: {
  onClose: () => void;
  onAccount: () => void;
}) {
  const groups = [...new Set(SHORTCUTS.map((shortcut) => shortcut.group))];
  return (
    <EditorDialog title="How this works" onClose={onClose}>
      <ol className="ce-steps">
        <li>
          <strong>Choose a chapter or subchapter.</strong> Its full title and
          timestamped descriptions appear in the editing area.
        </li>
        <li>
          <strong>Edit the title and descriptions directly.</strong> Click a
          timestamp or timeline diamond to listen there. Selecting text to edit
          does not move playback.
        </li>
        <li>
          <strong>Review & send</strong> opens a summary and instructions for
          sending through GitHub. Your edits stay in this browser until you send
          them.
        </li>
        <li>
          Press K to add a <strong>timestamped description</strong> at the
          playhead. Descriptions help search and reviewers; viewers see the
          named chapters and subchapters. Press P to add a subchapter.
        </li>
        <li>
          Press <strong>M</strong> to mark a moment to come back to. Your marks
          stay private unless you tick <strong>Send with my changes</strong>.
        </li>
        <li>
          <strong>Arrange your workspace.</strong> Drag panel headers to an edge
          to split the space, or to the middle to group panels as tabs. The Move
          button offers the same choices without dragging. Drag dividers to
          resize; focused dividers also use arrow keys.
        </li>
        <li>
          <strong>Windows</strong> opens the transcript, review markers,
          recording details and video. The transcript starts in a full-width
          bottom area. Your arrangement is saved in this browser; Windows →
          Reset the layout restores the starting arrangement.
        </li>
        <li>Right-click anything for more options.</li>
      </ol>
      <p>
        Sending needs a free GitHub account.{' '}
        <button type="button" className="text-link" onClick={onAccount}>
          Help me make one
        </button>
      </p>
      <p className="ce-muted">
        Everything works with the mouse; these keys are shortcuts. They pause
        while you type in a box.
      </p>
      {groups.map((group) => (
        <section key={group} className="ce-shortcut-group">
          <h3 className="ce-subhead">{group}</h3>
          <table className="ce-shortcuts">
            <tbody>
              {SHORTCUTS.filter((shortcut) => shortcut.group === group).map(
                (shortcut) => (
                  <tr key={shortcut.action}>
                    <th scope="row">
                      <kbd className="ce-key">{keyText(shortcut.label)}</kbd>
                    </th>
                    <td>{keyText(shortcut.help)}</td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </section>
      ))}
      <p className="ce-muted">
        {isMac()
          ? 'While dragging an edge: Option moves it alone, Cmd turns snapping off, Esc cancels. Cmd + scroll zooms the timeline.'
          : 'While dragging an edge: Alt moves it alone, Ctrl turns snapping off, Esc cancels. Ctrl + scroll zooms the timeline.'}
      </p>
    </EditorDialog>
  );
}
