import { setTimeout as _setTimeout } from 'timers';
import * as vscode from 'vscode';

function getManimCommand(
    document: vscode.TextDocument,
    cursorLine: number
): { command: string; enter: boolean } {
    const filePath = document.fileName;
    const contents = document.getText();
    const allLines = contents.split('\n');

    const classLines: { name: string; lineNo: number }[] = [];
    for (let i = 0; i < allLines.length; i++) {
        const m = allLines[i].match(/^class (.+?)\((.+?)\):/);
        if (m) {
            classLines.push({ name: m[1], lineNo: i });
        }
    }

    const matching = [...classLines].reverse().find(cl => cl.lineNo <= cursorLine);
    if (!matching) { throw new Error('No matching classes'); }

    const cmds = ['manimgl', `"${filePath}"`, matching.name];
    let enter = false;

    if (cursorLine !== matching.lineNo) {
        cmds.push(`-se ${cursorLine + 1}`);
        enter = true;
    }

    return { command: cmds.join(' '), enter };
}

function findTerminal(name: string): vscode.Terminal | undefined {
    return vscode.window.terminals.find(t => t.name === name);
}

async function sendTerminalCommand(
    terminalName: string,
    command: string,
    options: { clear?: boolean; center?: boolean; enter?: boolean } = {}
) {
    const { clear = true, center = true, enter = true } = options;
    const terminal = findTerminal(terminalName);
    if (!terminal) { return; }
    terminal.show(true);

    let full = '';
    if (clear) { full += '\x7F'.repeat(200); }
    if (center) { full += '\x0C'; }
    full += command;
    if (enter) { full += '\r'; }

    await new Promise<void>(resolve => _setTimeout(resolve, 50));
    terminal.sendText(full, false);
}

async function ensureTerminalExists(terminalName: string): Promise<number> {
    if (!findTerminal(terminalName)) {
        vscode.window.createTerminal({ name: terminalName });
        return 500;
    }
    return 0;
}

async function checkpointPasteWrapper(
    editor: vscode.TextEditor,
    argStr = '',
    terminalName = 'Manim'
) {
    const document = editor.document;
    const selection = editor.selection;
    await vscode.commands.executeCommand('editor.action.clipboardCopyAction');

    const selectedText = document.getText(selection);
    const lineText = document.lineAt(selection.start.line).text;
    const lines = (selectedText || lineText).split('\n');
    const firstLine = lines[0].trimStart();
    const startsWithComment = firstLine.startsWith('#');

    let command: string;
    if (lines.length === 1 && !startsWithComment) {
        command = selectedText || firstLine;
    } else {
        const comment = startsWithComment ? firstLine : '#';
        command = `checkpoint_paste(${argStr}) ${comment} (${lines.length} lines)`;
    }

    await sendTerminalCommand(terminalName, command);
    await vscode.window.showTextDocument(document, editor.viewColumn);
}

export function activate(context: vscode.ExtensionContext) {

    vscode.window.onDidOpenTerminal(terminal => {
        if (terminal.name === 'Manim') {
            terminal.sendText('C:/venv/py310/Scripts/Activate.ps1');
            terminal.sendText('cd C:/Users/pierrePER/AppData/Roaming/MobaXterm/home/p2perrault/enigmath/tools');
        }
    });

    context.subscriptions.push(
        vscode.commands.registerCommand('manim.runScene', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { vscode.window.showWarningMessage('No active editor.'); return; }
            const document = editor.document;
            await document.save();
            const { command, enter } = getManimCommand(document, editor.selection.active.line);
            const delay = await ensureTerminalExists('Manim');
            await new Promise<void>(resolve => _setTimeout(resolve, delay));
            await sendTerminalCommand('Manim', command, { enter });
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('manim.exit', async () => {
            await sendTerminalCommand('Manim', '\x03quit\n', { clear: false, center: false });
            await new Promise<void>(resolve => _setTimeout(resolve, 10));
            await sendTerminalCommand('Manim', '', { clear: false, center: true, enter: false });
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('manim.checkpointPaste', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { return; }
            await editor.document.save();
            await checkpointPasteWrapper(editor);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('manim.recordedCheckpointPaste', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { return; }
            await checkpointPasteWrapper(editor, 'record=True, progress_bar=False');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('manim.skippedCheckpointPaste', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { return; }
            await checkpointPasteWrapper(editor, 'skip=True');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('manim.reload', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { return; }
            await editor.document.save();
            const cursorLine = editor.selection.active.line;
            await sendTerminalCommand('Manim', `reload(${cursorLine + 1})`);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('manim.render', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { return; }
            const { command } = getManimCommand(editor.document, editor.selection.active.line);
            const fullCommand = command + ' --prerun -w';
            await vscode.env.clipboard.writeText(fullCommand);
            const delay = await ensureTerminalExists('Rendering');
            await new Promise<void>(resolve => _setTimeout(resolve, delay));
            await sendTerminalCommand('Rendering', fullCommand, { enter: false });
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('manim.copyReorient', async () => {
            const tmpFile = 'C:\\\\Users\\\\pierrePER\\\\AppData\\\\Local\\\\Temp\\\\_manim_reorient.txt';
            const cmd = `import numpy as np; _a = np.degrees(self.camera.frame.get_euler_angles()); _c = self.camera.frame.get_center(); _h = self.camera.frame.get_height(); open(r"${tmpFile}", "w").write(f"self.camera.frame.reorient({_a[0]:.1f}, {_a[1]:.1f}, {_a[2]:.1f}, ({_c[0]:.2f}, {_c[1]:.2f}, {_c[2]:.2f}), {_h:.1f})")`;
            await sendTerminalCommand('Manim', cmd);

            await new Promise<void>(resolve => _setTimeout(resolve, 500));
            const fs = require('fs');
            try {
                const result = fs.readFileSync('C:\\Users\\pierrePER\\AppData\\Local\\Temp\\_manim_reorient.txt', 'utf8');
                await vscode.env.clipboard.writeText(result);
                vscode.window.showInformationMessage(`Copied: ${result}`);
            } catch (e) {
                vscode.window.showErrorMessage('Failed to read reorient output.');
            }
        })
    );
}

export function deactivate() {}