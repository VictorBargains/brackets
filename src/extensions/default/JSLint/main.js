/*
 * Copyright (c) 2012 Adobe Systems Incorporated. All rights reserved.
 *  
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"), 
 * to deal in the Software without restriction, including without limitation 
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, 
 * and/or sell copies of the Software, and to permit persons to whom the 
 * Software is furnished to do so, subject to the following conditions:
 *  
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *  
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, 
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER 
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING 
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER 
 * DEALINGS IN THE SOFTWARE.
 * 
 */


/*global define, JSLINT, brackets */

/**
 * Provides JSLint results via the core linting extension point
 */
define(function (require, exports, module) {
    "use strict";
    
    // Load JSLint, a non-module lib
    require("thirdparty/jslint/jslint");
    
    // Load dependent modules
    var CodeInspection     = brackets.getModule("language/CodeInspection"),
        CommandManager     = brackets.getModule("command/CommandManager"),
        Commands           = brackets.getModule("command/Commands"),
        DocumentManager    = brackets.getModule("document/DocumentManager"),
        Editor             = brackets.getModule("editor/Editor").Editor,
        FileSystem         = brackets.getModule("filesystem/FileSystem"),
        PreferencesManager = brackets.getModule("preferences/PreferencesManager"),
        ProjectManager     = brackets.getModule("project/ProjectManager"),
        Strings            = brackets.getModule("strings"),
        _                  = brackets.getModule("thirdparty/lodash");
    
    var prefs = PreferencesManager.getExtensionPrefs("jslint");
    
    /**
     * @private
     * 
     * Used to keep track of the last options JSLint was run with to avoid running
     * again when there were no changes.
     */
    var _lastRunOptions;
    
    prefs.definePreference("options", "object", undefined)
        .on("change", function (e, data) {
            var options = prefs.get("options");
            if (!_.isEqual(options, _lastRunOptions)) {
                CodeInspection.requestRun(Strings.JSLINT_NAME);
            }
        });
    
    
    /**
     * @private
     * @type {string}
     */
    var _configFileName = ".jslint.json";
 
    /**
     * @private
     * @type {object}
     */
    var _jsLintConfig = null;
 
    /**
     * Load project-wide JSLint configuration.
     *
     * Brackets JSLint configuration should be in JSON format, with all the
     * JSLint options specified according to JSLint documentation.
     * 
     * JSLint project file should be located at <Project Root>/.jslint.json . It
     * is loaded each time project is changed or the configuration file is
     * modified.
     * 
     * @return nothing: set JSLint configuration object directly.
     *
     * @see <a href="http://www.jslint.com/lint.html#options">JSLint option
     * reference</a>.
     */
    function _loadProjectConfig(file) {
        if (file) {
            file.read(function (err, text) {
                var config;
                if (text) {
                    try {
                        config = JSON.parse(text);
                        _jsLintConfig = config;
//                        console.log('jslint: loaded config from %s: %s', file.fullPath, _jsLintConfig);
                    } catch (e) {
                        console.log('jslint: error: %s', e);
                    }
                    
                } else {
//                    console.log('jslint: could not load config from %s', file.fullPath);
                    _jsLintConfig = null;
                }
            });
        } else {
//            console.log('jslint: could not find config file.');
            _jsLintConfig = null;
        }
    }
    var projectRoot,
        configFileName,
        configFile;
    
    function _updateListeners(enabled) {
        if (enabled) {
            ProjectManager.on("projectOpen.jslint projectRefresh.jslint", function (e) {
                projectRoot = ProjectManager.getProjectRoot();
//                console.log('jslint: loaded project root %s', projectRootEntry.fullPath);
                configFileName = projectRoot.fullPath + _configFileName;
//                console.log('jslint: loaded config file name %s', fileName);
                configFile = FileSystem.getFileForPath(configFileName);
//                console.log('jslint: loaded file %s', configFile.fullPath);
                _loadProjectConfig(configFile);
            });

            DocumentManager.on("documentSaved.jslint documentRefreshed.jslint", function (e, doc) {
                if (configFileName === doc.file.fullPath) {
//                    console.log('jslint: reloading file %s', configFile.fullPath);
                    _loadProjectConfig(configFile);
                }
            });
            if (configFile && !_jsLintConfig) {
                _loadProjectConfig(configFile);
            }
        } else {
            _jsLintConfig = null;
            ProjectManager.off('.jslint');
            DocumentManager.off('.jslint');
        }
    }
    
    _updateListeners(CodeInspection.toggleEnabled);
    CommandManager.get(Commands.VIEW_TOGGLE_INSPECTION).on("checkedStateChange.jslint", function (event) {
        var enabled = event.target._checked;
        _updateListeners(enabled);
    });
    
    
    // Predefined environments understood by JSLint.
    var ENVIRONMENTS = ["browser", "node", "couch", "rhino"];
    
    // gets indentation size depending whether the tabs or spaces are used
    function _getIndentSize(fullPath) {
        return Editor.getUseTabChar(fullPath) ? Editor.getTabSize(fullPath) : Editor.getSpaceUnits(fullPath);
    }

    /**
     * Run JSLint on the current document. Reports results to the main UI. Displays
     * a gold star when no errors are found.
     */
    function lintOneFile(text, fullPath) {
        // If a line contains only whitespace (here spaces or tabs), remove the whitespace
        text = text.replace(/^[ \t]+$/gm, "");
        
        var options = _jsLintConfig || prefs.get("options");

        _lastRunOptions = _.clone(options);
        
        if (!options) {
            options = {};
        } else {
            options = _.clone(options);
        }
        
        if (!options.indent) {
            // default to using the same indentation value that the editor is using
            options.indent = _getIndentSize(fullPath);
        }
        
        // If the user has not defined the environment, we use browser by default.
        var hasEnvironment = _.some(ENVIRONMENTS, function (env) {
            return options[env] !== undefined;
        });
        
        if (!hasEnvironment) {
            options.browser = true;
        }

        var jslintResult = JSLINT(text, options);
        
        if (!jslintResult) {
            // Remove any trailing null placeholder (early-abort indicator)
            var errors = JSLINT.errors.filter(function (err) { return err !== null; });
            
            errors = errors.map(function (jslintError) {
                return {
                    // JSLint returns 1-based line/col numbers
                    pos: { line: jslintError.line - 1, ch: jslintError.character - 1 },
                    message: jslintError.reason,
                    type: CodeInspection.Type.WARNING
                };
            });
            
            var result = { errors: errors };

            // If array terminated in a null it means there was a stop notice
            if (errors.length !== JSLINT.errors.length) {
                result.aborted = true;
                errors[errors.length - 1].type = CodeInspection.Type.META;
            }
            
            return result;
        }
        return null;
    }
    
    // Register for JS files
    CodeInspection.register("javascript", {
        name: Strings.JSLINT_NAME,
        scanFile: lintOneFile
    });
    CodeInspection.register("json", {
        name: Strings.JSLINT_NAME,
        scanFile: lintOneFile
    });
});
