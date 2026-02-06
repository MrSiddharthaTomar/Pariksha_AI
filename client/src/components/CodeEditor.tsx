import React from 'react';
import Editor from '@monaco-editor/react';

interface CodeEditorProps {
    language: string;
    value: string;
    onChange: (value: string | undefined) => void;
    readOnly?: boolean;
}

const CodeEditor: React.FC<CodeEditorProps> = ({ language, value, onChange, readOnly = false }) => {
    return (
        <div className="h-[400px] border rounded-md overflow-hidden">
            <Editor
                height="100%"
                defaultLanguage={language}
                language={language}
                value={value}
                onChange={onChange}
                theme="vs-dark"
                options={{
                    minimap: { enabled: false },
                    fontSize: 14,
                    scrollBeyondLastLine: false,
                    readOnly: readOnly,
                    automaticLayout: true,
                }}
            />
        </div>
    );
};

export default CodeEditor;
