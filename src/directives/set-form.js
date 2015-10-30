"use strict";

angular.module('schemaForm').directive('setForm', [
    function () {
        return {
            restrict: 'A',
            scope: {
                form: '=setForm'
            }
        };
    }
]);