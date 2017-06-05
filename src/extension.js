/**
* @file: extension.js
* @author: yanglei07
* @description ..
* @create data: 2017-06-02 21:17:13
* @last modifity by: yanglei07
* @last modifity time: 2017-06-02 21:17:13
*/

/* global  */

/* eslint-disable fecs-camelcase */
/* eslint-enable fecs-camelcase */
'use strict';
/* eslint-disable fecs-no-require */
const Readable = require('stream').Readable;

// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
// const window = vscode.window;
// const workspace = vscode.workspace;
// const languages = vscode.languages;
const {window, workspace, languages} = vscode;

const fecs = require('fecs');
const File = require('vinyl');
/* eslint-enable fecs-no-require */

const maxUnvisibleEditorDataCount = 20;

let config = {
    en: false,
    level: 0,
    errorColor: '#f00',
    warningColor: '#ddb700',
    typeMap: new Map()
};

let editorFecsDataMap = new Map();
let diagnosticCollection = languages.createDiagnosticCollection('fecs');

let extContext = null;
let statusBarItem = null;

let warningPointImagePath = '';
let errorPointImagePath = '';

function log(...args) {
    /* eslint-disable no-console */
    console.log.apply(console, args);
    /* eslint-enable no-console */
}

function setTypeMap(configuration) {
    ['js', 'css', 'html'].forEach(type => {
        configuration.get(type + 'LikeExt', []).forEach(ext => {
            config.typeMap.set(ext, type);
        });
    });
}

function isSupportDocument(document) {
    let fileName = document.fileName || '';
    let ext = fileName.split('.').pop();

    return config.typeMap.has(ext) ? {type: config.typeMap.get(ext)} : null;
}

function isSupportEditor(editor) {
    if (!editor || !editor.document) {
        return false;
    }

    return isSupportDocument(editor.document);
}

function createCodeStream(code = '', type = '') {

    let buf = new Buffer(code);
    let file = new File({
        contents: buf,
        path: 'current-file.' + type,
        stat: {
            size: buf.length
        }
    });
    let stream = new Readable();
    stream._read = function () {
        this.emit('data', file);
        this.push(null);
    };
    return stream;
}

function generateEditorFecsData(editor) {
    if (!editor || editorFecsDataMap.has(editor.id)) {
        return;
    }

    let fileName = editor.document ? editor.document.fileName : '';

    editorFecsDataMap.set(editor.id, {
        fileName: fileName,
        oldDecorationTypeList: [],
        delayTimer: null,
        isRunning: false,
        needCheck: true,
        errorMap: null,
        diagnostics: [],
        warningDecorationList: [],
        errorDecorationList: []
    });
}
function getEditorFecsData(editor) {
    if (!editor) {
        return null;
    }
    return editorFecsDataMap.get(editor.id);
}
function checkEditorFecsData(document) {
    log('checkEditorFecsData: ', document.fileName);

    if (editorFecsDataMap.size - window.visibleTextEditors.length < maxUnvisibleEditorDataCount) {
        return;
    }

    let newMap = new Map();
    let oldMap = editorFecsDataMap;
    window.visibleTextEditors.forEach(e => {
        let data = getEditorFecsData(e);
        if (data) {
            newMap.set(e.id, data);
        }
    });
    editorFecsDataMap = newMap;
    oldMap.clear();
}

function runFecs(editor, needDelay) {
    if (!editor || !editor.document) {
        return;
    }

    let document = editor.document;

    if (!isSupportDocument(document)) {
        return;
    }

    generateEditorFecsData(editor);
    let editorFecsData = getEditorFecsData(editor);

    if (editorFecsData.isRunning) {
        return;
    }

    if (needDelay) {
        clearTimeout(editorFecsData.delayTimer);
        let editorId = editor.id;
        editorFecsData.delayTimer = setTimeout(() => {
            editorFecsData.delayTimer = null;

            runFecs(window.visibleTextEditors.filter(e => e.id === editorId)[0]);
        }, 1000);
        return;
    }

    if (!editorFecsData.needCheck) {
        renderErrors(editor);
        return;
    }

    let code = document.getText();
    let stream = createCodeStream(code, document.fileName.split('.').pop());

    log('runFecs');

    editorFecsData.isRunning = true;
    editorFecsData.needCheck = false;
    fecs.check({
        stream: stream,
        reporter: config.en ? '' : 'baidu',
        type: 'js,css,html'
    }, function (success, json) {
        let errors = (json[0] || {}).errors || [];
        log('checkDone! Error count: ', errors.length);
        prepareErrors(errors, editor);
        renderErrors(editor);
        editorFecsData.isRunning = false;
    });
}

function generateDecorationType(type = 'warning') {
    let pointPath = warningPointImagePath;
    let rulerColor = config.warningColor;

    if (type === 'error') {
        pointPath = errorPointImagePath;
        rulerColor = config.errorColor;
    }

    return vscode.window.createTextEditorDecorationType({
        gutterIconPath: pointPath,
        gutterIconSize: 'contain',
        overviewRulerColor: rulerColor
    });
}

function generateDecoration(lineIndex) {
    let startPos = new vscode.Position(lineIndex, 0);
    let endPos = new vscode.Position(lineIndex, 0);
    let decoration = {
        range: new vscode.Range(startPos, endPos)
    };
    return decoration;
}

function generateDiagnostic(data) {

    let lineIndex = data.line - 1;
    let cloumnIndex = data.column - 1;
    let startPos = new vscode.Position(lineIndex, cloumnIndex);
    let endPos = new vscode.Position(lineIndex, cloumnIndex);
    let range = new vscode.Range(startPos, endPos);

    let message = data.msg;
    let severity = data.severity === 2 ? 0 : 1;

    return new vscode.Diagnostic(range, message, severity);
}

function decorateEditor(editor, list, type, oldDecorationTypeList) {
    if (list.length) {
        let dt = generateDecorationType(type);
        oldDecorationTypeList.push(dt);
        editor.setDecorations(dt, list);
    }
}

function prepareErrors(errors, editor) {

    let editorFecsData = getEditorFecsData(editor);
    let oldDecorationTypeList = editorFecsData.oldDecorationTypeList;

    if (oldDecorationTypeList.length) {
        oldDecorationTypeList.forEach(type => type.dispose());
        oldDecorationTypeList = editorFecsData.oldDecorationTypeList = [];
    }

    if (editorFecsData.errorMap) {
        editorFecsData.errorMap.clear();
    }
    let errorMap = editorFecsData.errorMap = new Map();
    let diagnostics = editorFecsData.diagnostics = [];

    let warningDecorationList = editorFecsData.warningDecorationList = [];
    let errorDecorationList = editorFecsData.errorDecorationList = [];

    errors.forEach(err => {
        let lineIndex = err.line - 1;
        err.msg = err.message.trim() + ' (rule: ' + err.rule + ')';
        diagnostics.push(generateDiagnostic(err));
        errorMap.set(lineIndex, (errorMap.get(lineIndex) || []).concat(err));
    });
    errorMap.forEach(errs => {
        errs.sort((a, b) => b.severity - a.severity);
        let err = errs[0];
        let lineIndex = err.line - 1;
        let decotation = generateDecoration(lineIndex);
        if (err.severity === 2) {
            errorDecorationList.push(decotation);
        }
        else {
            warningDecorationList.push(decotation);
        }
    });
}

function renderErrors(editor) {
    let editorFecsData = getEditorFecsData(editor);

    if (!editorFecsData) {
        return;
    }

    let {errorDecorationList, warningDecorationList, oldDecorationTypeList} = editorFecsData;
    decorateEditor(editor, errorDecorationList, 'error', oldDecorationTypeList);
    decorateEditor(editor, warningDecorationList, 'warning', oldDecorationTypeList);

    // log(JSON.stringify(errors, null, 4));
    showErrorMessageInStatusBar(editor);
    showDiagnostics(editor);
}

function showErrorMessageInStatusBar(editor) {

    if (editor !== window.activeTextEditor) {
        return;
    }

    let selection = editor.selection;
    let line = selection.start.line; // 只显示选区第一行的错误信息
    let editorFecsData = getEditorFecsData(editor) || {};
    let errorMap = editorFecsData.errorMap;
    let errList = [];

    if (errorMap && errorMap.has(line)) {
        errList = errorMap.get(line);
    }

    if (!statusBarItem) {
        statusBarItem = window.createStatusBarItem(1);
        statusBarItem.show();
    }

    let showErr = errList[0] || {msg: '', severity: 0};

    statusBarItem.text = showErr.msg;
    statusBarItem.color = showErr.severity === 2 ? config.errorColor : config.warningColor;
    statusBarItem.tooltip = errList.map(err => err.msg).join('\n');
}
function clearStatusBarMessage() {
    if (!statusBarItem) {
        return;
    }

    statusBarItem.text = '';
    statusBarItem.tooltip = '';
}

function showDiagnostics(editor) {
    let editorFecsData = getEditorFecsData(editor);

    if (!editorFecsData) {
        return;
    }

    let uri = editor.document.uri;
    let diagnostics = editorFecsData.diagnostics;

    if (window.activeTextEditor !== editor) {
        diagnosticCollection.delete(uri);
        return;
    }

    diagnosticCollection.set(uri, diagnostics);
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
function activate(context) {

    extContext = context;
    warningPointImagePath = extContext.asAbsolutePath('images/warning.svg');
    errorPointImagePath = extContext.asAbsolutePath('images/error.svg');

    let configuration = workspace.getConfiguration('vscode-fecs-plugin');
    config.en = configuration.get('en', false);
    config.level = configuration.get('level', 0);
    setTypeMap(configuration);

    workspace.onDidCloseTextDocument(function (document) {
        log('workspace.onDidCloseTextDocument');
        if (!isSupportDocument(document)) {
            return;
        }
        checkEditorFecsData(document);

        if (!window.activeTextEditor) {
            clearStatusBarMessage();
        }
    });

    // 编辑文档后触发(coding...)
    workspace.onDidChangeTextDocument(function (event) {
        log('workspace.onDidChangeTextDocument');
        let editor = window.activeTextEditor;
        let document = event.document;

        if (!isSupportDocument(document)) {
            return;
        }

        window.visibleTextEditors.filter(e =>
            e.document && e.document.fileName === document.fileName
        ).forEach(e => {
            (getEditorFecsData(e) || {}).needCheck = true;
            runFecs(e, true);
        });
        showErrorMessageInStatusBar(editor);
    });

    window.onDidChangeVisibleTextEditors(function (editors) {
        log('window.onDidChangeVisibleTextEditors');
    });

    // 切换文件 tab 后触发
    window.onDidChangeActiveTextEditor(function (editor) {
        if (!editor) {
            return;
        }
        log('window.onDidChangeActiveTextEditor: ', editor.id);

        diagnosticCollection.clear();
        showErrorMessageInStatusBar(editor);
        showDiagnostics(editor);

        window.visibleTextEditors.forEach(function (e, i) {
            if (!isSupportEditor(e)) {
                return;
            }
            runFecs(e, true);
        });

        // if (!isSupportEditor(editor)) {
        //     return;
        // }

        // runFecs(editor, true);
    });

    // 光标移动后触发
    window.onDidChangeTextEditorSelection(function (event) {
        log('window.onDidChangeTextEditorSelection');

        if (!event.textEditor || !event.textEditor.document || !isSupportDocument(event.textEditor.document)) {
            return;
        }

        if (event.textEditor === window.activeTextEditor) {
            showErrorMessageInStatusBar(event.textEditor);
        }
    });


    window.visibleTextEditors.forEach(function (editor, i) {
        runFecs(editor);
    });
}
exports.activate = activate;

// this method is called when your extension is deactivated
function deactivate() {
}
exports.deactivate = deactivate;
