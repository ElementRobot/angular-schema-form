"use strict";

// FIXME: type template (using custom builder)
angular.module('schemaForm').provider('sfBuilder', ['sfPathProvider', function (sfPathProvider) {

    var SNAKE_CASE_REGEXP = /[A-Z]/g,
        formId = 0,
        snakeCase = function (name, separator) {
            separator = separator || '_';
            return name.replace(SNAKE_CASE_REGEXP, function (letter, pos) {
                return (pos ? separator : '') + letter.toLowerCase();
            });
        },
        builders,
        stdBuilders;

    builders = {
        sfField: function (args) {
            args.fieldFrag.firstChild.setAttribute('sf-field', formId);

            // We use a lookup table for easy access to our form.
            args.lookup['f' + formId] = args.form;
            formId++;
        },
        ngModel: function (args) {
            var key  = args.form.key,
                modelValue,
                strKey,
                nodes,
                i,
                j,
                n,
                conf,
                attributes,
                val;

            if (!args.form.key) {
                return;
            }

            // Redact part of the key, used in arrays
            // KISS keyRedaction is a number.
            if (args.state.keyRedaction) {
                key = key.slice(args.state.keyRedaction);
            }

            // Stringify key.
            if (!args.state.modelValue) {
                strKey = sfPathProvider.stringify(key).replace(/"/g, '&quot;');
                modelValue = (args.state.modelName || 'model');

                if (strKey) { // Sometimes, like with arrays directly in arrays strKey is nothing.
                    modelValue += (strKey[0] !== '[' ? '.' : '') + strKey;
                }
            } else {
                // Another builder, i.e. array has overriden the modelValue
                modelValue = args.state.modelValue;
            }

            // Find all sf-field-value attributes.
            // No value means a add a ng-model.
            // sf-field-value="replaceAll", loop over attributes and replace $$value$$ in each.
            // sf-field-value="attrName", replace or set value of that attribute.
            nodes = args.fieldFrag.querySelectorAll('[sf-field-model]');
            for (i = 0; i < nodes.length; i++) {
                n = nodes[i];
                conf = n.getAttribute('sf-field-model');
                if (!conf || conf === '') {
                    n.setAttribute('ng-model', modelValue);
                } else if (conf === 'replaceAll') {
                    attributes = n.attributes;
                    for (j = 0; j < attributes.length; j++) {
                        if (attributes[j].value && attributes[j].value.indexOf('$$value') !== -1) {
                            attributes[j].value = attributes[j].value.replace(/\$\$value\$\$/g, modelValue);
                        }
                    }
                } else {
                    val = n.getAttribute(conf);
                    if (val && val.indexOf('$$value$$')) {
                        n.setAttribute(conf, val.replace(/\$\$value\$\$/g, modelValue));
                    } else {
                        n.setAttribute(conf, modelValue);
                    }
                }
            }
        },
        simpleTransclusion: function (args) {
            var children = args.build(args.form.items, args.path + '.items', args.state);
            args.fieldFrag.firstChild.appendChild(children);
        },

        // Patch on ngModelOptions, since it doesn't like waiting for its value.
        ngModelOptions: function (args) {
            if (args.form.ngModelOptions && Object.keys(args.form.ngModelOptions).length > 0) {
                args.fieldFrag.firstChild.setAttribute('ng-model-options', JSON.stringify(args.form.ngModelOptions));
            }
        },
        transclusion: function (args) {
            var transclusions = args.fieldFrag.querySelectorAll('[sf-field-transclude]'),
                i,
                n,
                sub,
                items,
                childFrag;

            if (transclusions.length) {
                for (i = 0; i < transclusions.length; i++) {
                    n = transclusions[i];

                    // The sf-transclude attribute is not a directive,
                    // but has the name of what we're supposed to
                    // traverse. Default to `items`
                    sub = n.getAttribute('sf-field-transclude') || 'items';
                    items = args.form[sub];

                    if (items) {
                        childFrag = args.build(items, args.path + '.' + sub, args.state);
                        n.appendChild(childFrag);
                    }
                }
            }
        },
        condition: function (args) {
            // Do we have a condition? Then we slap on an ng-if on all children,
            // but be nice to existing ng-if.
            if (args.form.condition) {
                var evalExpr = [
                        'evalExpr(',
                        args.path,
                        '.condition, { model: model, "arrayIndex": $index})'
                    ].join(''),
                    strKey,
                    children,
                    i,
                    child,
                    ngIf;

                if (args.form.key) {
                    strKey = sfPathProvider.stringify(args.form.key);
                    evalExpr = 'evalExpr(' + args.path + '.condition,{ model: model, "arrayIndex": $index, ' +
                                         '"modelValue": model' + (strKey[0] === '[' ? '' : '.') + strKey + '})';
                }

                children = args.fieldFrag.children || args.fieldFrag.childNodes;
                for (i = 0; i < children.length; i++) {
                    child = children[i];
                    ngIf = child.getAttribute('ng-if');
                    child.setAttribute(
                        'ng-if',
                        ngIf ? '(' + ngIf + ') || (' + evalExpr + ')' : evalExpr
                    );
                }
            }
        },
        array: function (args) {
            var items = args.fieldFrag.querySelector('[schema-form-array-items]'),
                state,
                childFrag;

            if (items) {
                state = angular.copy(args.state);
                state.keyRedaction = state.keyRedaction || 0;
                state.keyRedaction += args.form.key.length + 1;

                // Special case, an array with just one item in it that is not an object.
                // So then we just override the modelValue
                if (args.form.schema && args.form.schema.items &&
                        args.form.schema.items.type &&
                        args.form.schema.items.type.indexOf('object') === -1 &&
                        args.form.schema.items.type.indexOf('array') === -1) {
                    state.modelValue = 'modelArray[$index]';
                } else {
                    state.modelName = 'item';
                }

                // Flag to the builder that where in an array.
                // This is needed for compatabiliy if a "old" add-on is used that
                // hasn't been transitioned to the new builder.
                state.arrayCompatFlag = true;

                childFrag = args.build(args.form.items, args.path + '.items', state);
                items.appendChild(childFrag);
            }
        }
    };
    this.builders = builders;
    stdBuilders = [
        builders.sfField,
        builders.ngModel,
        builders.ngModelOptions,
        builders.condition
    ];
    this.stdBuilders = stdBuilders;

    this.$get = ['$templateCache', 'sfPath', function ($templateCache, sfPath) {
        var checkForSlot,
            build;


        checkForSlot = function (form, slots) {
            var slot;

            // Finally append this field to the frag.
            // Check for slots
            if (form.key) {
                slot = slots[sfPath.stringify(form.key)];
                if (slot) {
                    while (slot.firstChild) {
                        slot.removeChild(slot.firstChild);
                    }
                    return slot;
                }
            }
        };

        build = function (items, decorator, templateFn, slots, path, state, lookup) {
            var container = document.createDocumentFragment();

            state = state || {};
            lookup = lookup || Object.create(null);
            path = path || 'schemaForm.form';
            items.reduce(function (frag, f, index) {
                var n,
                    field,
                    tmpl,
                    div,
                    template,
                    args,
                    builderFn;

                // Sanity check.
                if (!f.type) {
                    return frag;
                }

                field = decorator[f.type] || decorator['default'];
                if (!field.replace) {
                    // Backwards compatability build
                    n = document.createElement(snakeCase(decorator.__name, '-'));
                    if (state.arrayCompatFlag) {
                        n.setAttribute('form', 'copyWithIndex($index)');
                    } else {
                        n.setAttribute('form', path + '[' + index + ']');
                    }

                    (checkForSlot(f, slots) || frag).appendChild(n);

                } else {
                    // Reset arrayCompatFlag, it's only valid for direct children of the array.
                    state.arrayCompatFlag = false;

                    // TODO: Create a couple fo testcases, small and large and
                    //       measure optmization. A good start is probably a cache of DOM nodes for a particular
                    //       template that can be cloned instead of using innerHTML
                    div = document.createElement('div');
                    template = templateFn(f, field) || templateFn(f, decorator['default']);
                    div.innerHTML = template;

                    // Move node to a document fragment, we don't want the div.
                    tmpl = document.createDocumentFragment();
                    while (div.childNodes.length > 0) {
                        tmpl.appendChild(div.childNodes[0]);
                    }

                    // Possible builder, often a noop
                    args = {
                        fieldFrag: tmpl,
                        form: f,
                        lookup: lookup,
                        state: state,
                        path: path + '[' + index + ']',

                        // Recursive build fn
                        build: function (items, path, state) {
                            return build(items, decorator, templateFn, slots, path, state, lookup);
                        }

                    };

                    // Let the form definiton override builders if it wants to.
                    builderFn = f.builder || field.builder;

                    // Builders are either a function or a list of functions.
                    if (typeof builderFn === 'function') {
                        builderFn(args);
                    } else {
                        builderFn.forEach(function (fn) { fn(args); });
                    }

                    // Append
                    (checkForSlot(f, slots) || frag).appendChild(tmpl);
                }
                return frag;
            }, container);

            return container;
        };

        return {
            /**
             * Builds a form from a canonical form definition
             */
            build: function (form, decorator, slots, lookup) {
                return build(form, decorator, function (form, field) {
                    if (form.type === 'template') {
                        return form.template;
                    }
                    return $templateCache.get(field.template);
                }, slots, undefined, undefined, lookup);

            },
            builder: builders,
            stdBuilders: stdBuilders,
            internalBuild: build
        };
    }];

}]);
