"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const timers_1 = require("timers");
const vscode = __importStar(require("vscode"));
function getManimCommand(document, cursorLine) {
    const filePath = document.fileName;
    const contents = document.getText();
    const allLines = contents.split('\n');
    const classLines = [];
    for (let i = 0; i < allLines.length; i++) {
        const m = allLines[i].match(/^class (.+?)\((.+?)\):/);
        if (m) {
            classLines.push({ name: m[1], lineNo: i });
        }
    }
    const matching = [...classLines].reverse().find(cl => cl.lineNo <= cursorLine);
    if (!matching) {
        throw new Error('No matching classes');
    }
    const cmds = ['manimgl', `"${filePath}"`, matching.name];
    let enter = false;
    if (cursorLine !== matching.lineNo) {
        cmds.push(`-se ${cursorLine + 1}`);
        enter = true;
    }
    return { command: cmds.join(' '), enter };
}
function findTerminal(name) {
    return vscode.window.terminals.find(t => t.name === name);
}
async function sendTerminalCommand(terminalName, command, options = {}) {
    const { clear = true, center = true, enter = true } = options;
    const terminal = findTerminal(terminalName);
    if (!terminal) {
        return;
    }
    terminal.show(true);
    let full = '';
    if (clear) {
        full += '\x7F'.repeat(200);
    }
    if (center) {
        full += '\x0C';
    }
    full += command;
    if (enter) {
        full += '\r';
    }
    await new Promise(resolve => (0, timers_1.setTimeout)(resolve, 50));
    terminal.sendText(full, false);
}
async function ensureTerminalExists(terminalName) {
    if (!findTerminal(terminalName)) {
        vscode.window.createTerminal({ name: terminalName });
        return 500;
    }
    return 0;
}
async function checkpointPasteWrapper(editor, argStr = '', terminalName = 'Manim') {
    const document = editor.document;
    const selection = editor.selection;
    await vscode.commands.executeCommand('editor.action.clipboardCopyAction');
    const selectedText = document.getText(selection);
    const lineText = document.lineAt(selection.start.line).text;
    const lines = (selectedText || lineText).split('\n');
    const firstLine = lines[0].trimStart();
    const startsWithComment = firstLine.startsWith('#');
    let command;
    if (lines.length === 1 && !startsWithComment) {
        command = selectedText || firstLine;
    }
    else {
        const comment = startsWithComment ? firstLine : '#';
        command = `checkpoint_paste(${argStr}) ${comment} (${lines.length} lines)`;
    }
    await sendTerminalCommand(terminalName, command);
    await vscode.window.showTextDocument(document, editor.viewColumn);
}
function activate(context) {
    vscode.window.onDidOpenTerminal(terminal => {
        if (terminal.name === 'Manim') {
            terminal.sendText('C:/venv/py310/Scripts/Activate.ps1');
            terminal.sendText('cd C:/Users/pierrePER/AppData/Roaming/MobaXterm/home/p2perrault/enigmath/tools');
        }
    });
    context.subscriptions.push(vscode.commands.registerCommand('manim.runScene', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active editor.');
            return;
        }
        const document = editor.document;
        await document.save();
        const { command, enter } = getManimCommand(document, editor.selection.active.line);
        const delay = await ensureTerminalExists('Manim');
        await new Promise(resolve => (0, timers_1.setTimeout)(resolve, delay));
        await sendTerminalCommand('Manim', command, { enter });
    }));
    context.subscriptions.push(vscode.commands.registerCommand('manim.exit', async () => {
        await sendTerminalCommand('Manim', '\x03quit\n', { clear: false, center: false });
        await new Promise(resolve => (0, timers_1.setTimeout)(resolve, 10));
        await sendTerminalCommand('Manim', '', { clear: false, center: true, enter: false });
    }));
    context.subscriptions.push(vscode.commands.registerCommand('manim.checkpointPaste', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        await editor.document.save();
        await checkpointPasteWrapper(editor);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('manim.recordedCheckpointPaste', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        await checkpointPasteWrapper(editor, 'record=True, progress_bar=False');
    }));
    context.subscriptions.push(vscode.commands.registerCommand('manim.skippedCheckpointPaste', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        await checkpointPasteWrapper(editor, 'skip=True');
    }));
    context.subscriptions.push(vscode.commands.registerCommand('manim.reload', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        await editor.document.save();
        const cursorLine = editor.selection.active.line;
        await sendTerminalCommand('Manim', `reload(${cursorLine + 1})`);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('manim.render', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        const { command } = getManimCommand(editor.document, editor.selection.active.line);
        const fullCommand = command + ' --prerun -w';
        await vscode.env.clipboard.writeText(fullCommand);
        const delay = await ensureTerminalExists('Rendering');
        await new Promise(resolve => (0, timers_1.setTimeout)(resolve, delay));
        await sendTerminalCommand('Rendering', fullCommand, { enter: false });
    }));
}
function deactivate() { }
//# sourceMappingURL=extension.js.map