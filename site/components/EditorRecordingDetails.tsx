import type { EditorIssue, EditorState } from '../lib/recording-editor';
import type { Topic } from '../lib/recording-schema';
import { parseScriptureReference } from '../lib/scripture';
import { ChipList, WordCount } from './editor-fields';

export default function EditorRecordingDetails({
  state,
  topics,
  issues,
  onChange,
}: {
  state: EditorState;
  topics: Topic[];
  issues: EditorIssue[];
  onChange: (change: Partial<EditorState>, key?: string) => void;
}) {
  return (
    <div className="ce-window-body ce-details-window">
      <label className="ce-field">
        <span className="ce-label">
          Title <span className="ce-muted">the sermon title as announced</span>
        </span>
        <input
          id="ce-details-title"
          value={state.title}
          onChange={(event) =>
            onChange({ title: event.target.value }, 'recording-title')
          }
        />
      </label>
      <label className="ce-field ce-grow">
        <span className="ce-label">
          Sermon description <WordCount text={state.description} />
        </span>
        <textarea
          rows={8}
          value={state.description}
          placeholder="What the sermon argues and asks of the listener, in one paragraph."
          onChange={(event) =>
            onChange(
              { description: event.target.value },
              'recording-description',
            )
          }
        />
      </label>
      <ChipList
        label="Scripture"
        items={state.scripture}
        placeholder="e.g. John 15:1-11"
        onChange={(scripture) => onChange({ scripture })}
        validate={(value) =>
          parseScriptureReference(value)
            ? undefined
            : 'That is not a Bible reference this archive understands. Try “Book 3:16” or “Book 3:16-18”.'
        }
      />
      <ChipList
        label="Topics"
        items={state.topics}
        placeholder="Choose a topic"
        onChange={(topics) => onChange({ topics })}
        options={topics.map((topic) => ({
          value: topic.topicId,
          name: topic.topicName,
        }))}
      />
      {issues.map((issue) => (
        <p key={issue.message} className={`ce-problem is-${issue.level}`}>
          {issue.message}
        </p>
      ))}
    </div>
  );
}
