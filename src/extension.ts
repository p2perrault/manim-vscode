import { setTimeout as _setTimeout } from 'timers';
import * as vscode from 'vscode';
import * as fs from 'fs';

let markedAudioTime: number | null = null;
const AUDIO_TIME_FILE = 'C:\\Users\\pierrePER\\AppData\\Local\\Temp\\_manim_audio_time.txt';

let ipythonActive = false;

function setIPythonActive(active: boolean) {
    ipythonActive = active;
    vscode.commands.executeCommand('setContext', 'manim.ipythonActive', active);
}

async function markAudioTime(terminalName = 'Manim') {
    let prevMtime = 0;
    try { prevMtime = fs.statSync(AUDIO_TIME_FILE).mtimeMs; } catch { /* first run */ }

    const cmd = `open(r"${AUDIO_TIME_FILE}", "w").write(str(self.time))`;
    await sendTerminalCommand(terminalName, cmd);

    const updated = await waitForFileUpdate(AUDIO_TIME_FILE, prevMtime);
    if (!updated) {
        vscode.window.showErrorMessage('Timed out waiting to read scene time.');
        return;
    }

    try {
        const result = fs.readFileSync(AUDIO_TIME_FILE, 'utf8');
        const parsed = parseFloat(result);
        if (isNaN(parsed)) {
            vscode.window.showErrorMessage(`Scene time file had unexpected content: "${result}"`);
            return;
        }
        markedAudioTime = parsed;
        vscode.window.showInformationMessage(`Audio mark set: ${markedAudioTime.toFixed(2)}s`);
    } catch (e) {
        vscode.window.showErrorMessage('Failed to read scene time.');
    }
}

function getConstructStartLine(
    document: vscode.TextDocument,
    cursorLine: number
): number {
const lines = document.getText().split('\n');
    // Find the scene class containing the cursor.
    let classLine = -1;

    for (let i = 0; i <= cursorLine; i++) {
        if (/^class (.+?)\((.+?)\):/.test(lines[i])) {
            classLine = i;
        }
    }

    if (classLine === -1) {
        throw new Error('No matching scene class found');
    }

    // Find "def construct(self):" inside that class.
    for (let i = classLine + 1; i < lines.length; i++) {
        // Stop if another class begins.
        if (/^class (.+?)\((.+?)\):/.test(lines[i])) {
            break;
        }

        if (/^\s*def\s+construct\s*\(\s*self\s*\)\s*:/.test(lines[i])) {
            // Manim's -se argument is 1-based.
            // We want the line immediately after "def construct(self):".
            return i + 2;
        }
    }

    throw new Error('Could not find def construct(self)');
}


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

async function waitForFileUpdate(
    filePath: string,
    previousMtimeMs: number,
    timeoutMs = 30000,
    intervalMs = 100
): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const stat = fs.statSync(filePath);
            if (stat.mtimeMs > previousMtimeMs) {
                return true;
            }
        } catch {
            // not written yet — keep waiting
        }
        await new Promise<void>(resolve => _setTimeout(resolve, intervalMs));
    }
    return false;
}

async function sendTerminalCommand(
    terminalName: string,
    command: string,
    options: { clear?: boolean; center?: boolean; enter?: boolean; waitForCompletion?: boolean } = {}
): Promise<void> {
    const { clear = true, center = true, enter = true, waitForCompletion = false } = options;
    const terminal = findTerminal(terminalName);
    if (!terminal) { return; }
    terminal.show(true);

    let finalCommand = command;
    let prevMarkerMtime = 0;
    if (waitForCompletion) {
        try { prevMarkerMtime = fs.statSync(AUDIO_TIME_FILE).mtimeMs; } catch { /* first run */ }
        finalCommand = `${command} open(r"${AUDIO_TIME_FILE}", "w").write("done")`;
    }

    let full = '';
    if (clear) { full += '\x7F'.repeat(200); }
    if (center) { full += '\x0C'; }
    full += finalCommand;
    if (enter) { full += '\r'; }

    await new Promise<void>(resolve => _setTimeout(resolve, 50));
    terminal.sendText(full, false);

    if (waitForCompletion) {
        const done = await waitForFileUpdate(AUDIO_TIME_FILE, prevMarkerMtime);
        if (!done) {
            throw new Error(`Timed out waiting for command to finish: ${command}`);
        }
    }
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
    const seekTime = markedAudioTime !== null ? markedAudioTime : 0;

    let baseCommand: string;
    if (lines.length === 1 && !startsWithComment) {
        baseCommand = selectedText || firstLine;
    } else {
        const comment = startsWithComment ? firstLine : '#';
        baseCommand = `checkpoint_paste(${argStr})`;
    }

    const command = `(self.audio.play_from(${seekTime}) if hasattr(self, 'audio') else None); ${baseCommand}; (self.audio.stop() if hasattr(self, 'audio') else None)`;
    

    await sendTerminalCommand(terminalName, command);
    await vscode.window.showTextDocument(document, editor.viewColumn);
}

export function activate(context: vscode.ExtensionContext) {
    setIPythonActive(false);
    vscode.window.onDidOpenTerminal(terminal => {
        if (terminal.name === 'Manim') {
            terminal.sendText('C:/venv/py311/Scripts/Activate.ps1');
            terminal.sendText('cd C:/Users/pierrePER/AppData/Roaming/MobaXterm/home/p2perrault/enigmath/tools/manim_tools');
        }
    });

    vscode.window.onDidCloseTerminal(terminal => {
        if (terminal.name === 'Manim' && !findTerminal('Manim')) {
            setIPythonActive(false);
        }
    });


    context.subscriptions.push(
        vscode.commands.registerCommand('manim.runScene', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { vscode.window.showWarningMessage('No active editor.'); return; }
        const document = editor.document;

        const minimalLine = getConstructStartLine(
            document,
            editor.selection.active.line
        );

        const { command, enter } = getManimCommand(
            document,
            minimalLine - 1
        );

        const delay = await ensureTerminalExists('Manim');

        await new Promise<void>(resolve =>
            _setTimeout(resolve, delay)
        );

        await sendTerminalCommand(
            'Manim',
            command,
            { enter }
        );

        setIPythonActive(true);

        // Give Manim time to finish launching and enter IPython.
        await new Promise<void>(resolve =>
            _setTimeout(resolve, 1500)
        );

        // Now test reload using the actual cursor line.
        const cursorLine = editor.selection.active.line;

        await sendTerminalCommand(
            'Manim',
            `reload(${cursorLine + 1});`,
            { waitForCompletion: true }
        );
        await markAudioTime();
    })

    );


    context.subscriptions.push(
        vscode.commands.registerCommand('manim.smartRunOrReload', async () => {
            if (ipythonActive) {
                await vscode.commands.executeCommand('manim.reload');
            } else {
                await vscode.commands.executeCommand('manim.runScene');
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('manim.toggleIPython', async () => {
            setIPythonActive(!ipythonActive);
            vscode.window.setStatusBarMessage(`IPython embed: ${ipythonActive ? 'active' : 'inactive'}`, 2000);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('manim.exit', async () => {
            await sendTerminalCommand('Manim', '\x03quit\n', { clear: false, center: false });
            await new Promise<void>(resolve => _setTimeout(resolve, 10));
            await sendTerminalCommand('Manim', '', { clear: false, center: true, enter: false });
            setIPythonActive(false);
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

    vscode.commands.registerCommand('manim.reload', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { return; }
        await editor.document.save();
        const cursorLine = editor.selection.active.line;
        await sendTerminalCommand(
            'Manim',
            `reload(${cursorLine + 1});`, 
            { waitForCompletion: true }
        );
        await markAudioTime();
    })

    context.subscriptions.push(
        vscode.commands.registerCommand('manim.markAudioTime', async () => {
            await markAudioTime();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('manim.render', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { return; }
            const document = editor.document;

            // Find the enclosing class line so the whole scene renders,
            // regardless of where the cursor currently sits.
            const allLines = document.getText().split('\n');
            const classLines: { name: string; lineNo: number }[] = [];
            for (let i = 0; i < allLines.length; i++) {
                const m = allLines[i].match(/^class (.+?)\((.+?)\):/);
                if (m) { classLines.push({ name: m[1], lineNo: i }); }
            }
            const matching = [...classLines].reverse().find(cl => cl.lineNo <= editor.selection.active.line);
            if (!matching) { vscode.window.showWarningMessage('No matching scene class found.'); return; }

            await vscode.commands.executeCommand('manim.exit');
            const fullCommand = `manimgl "${document.fileName}" ${matching.name} --prerun -w`;
            await vscode.env.clipboard.writeText(fullCommand);
            const delay = await ensureTerminalExists('Manim');
            await new Promise<void>(resolve => _setTimeout(resolve, delay));
            await sendTerminalCommand('Manim', fullCommand, { enter: true });
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