import * as d3 from 'd3';

import {pluck, printers, utils} from '../core/utils';
import {deregisterChart, instanceOfChart, redrawAll, registerChart, renderAll} from '../core/core';
import {constants} from '../core/constants';
import {events} from '../core/events';
import {logger} from '../core/logger';
import {InvalidStateException} from '../core/invalid-state-exception';
import {BadArgumentException} from '../core/bad-argument-exception';

const _defaultFilterHandler = (dimension, filters) => {
    if (filters.length === 0) {
        dimension.filter(null);
    } else if (filters.length === 1 && !filters[0].isFiltered) {
        // single value and not a function-based filter
        dimension.filterExact(filters[0]);
    } else if (filters.length === 1 && filters[0].filterType === 'RangedFilter') {
        // single range-based filter
        dimension.filterRange(filters[0]);
    } else {
        dimension.filterFunction(d => {
            for (let i = 0; i < filters.length; i++) {
                const filter = filters[i];
                if (filter.isFiltered && filter.isFiltered(d)) {
                    return true;
                } else if (filter <= d && filter >= d) {
                    return true;
                }
            }
            return false;
        });
    }
    return filters;
};

const _defaultHasFilterHandler = (filters, filter) => {
    if (filter === null || typeof (filter) === 'undefined') {
        return filters.length > 0;
    }
    return filters.some(f => filter <= f && filter >= f);
};

const _defaultRemoveFilterHandler = (filters, filter) => {
    for (let i = 0; i < filters.length; i++) {
        if (filters[i] <= filter && filters[i] >= filter) {
            filters.splice(i, 1);
            break;
        }
    }
    return filters;
};

const _defaultAddFilterHandler = (filters, filter) => {
    filters.push(filter);
    return filters;
};

const _defaultResetFilterHandler = filters => [];

/**
 * `dc.baseMixin` is an abstract functional object representing a basic `dc` chart object
 * for all chart and widget implementations. Methods from the {@link #dc.baseMixin dc.baseMixin} are inherited
 * and available on all chart implementations in the `dc` library.
 * @name baseMixin
 * @memberof dc
 * @mixin
 * @param {Object} _chart
 * @returns {dc.baseMixin}
 */
export class BaseMixin {
    constructor () {
        this.__dcFlag__ = utils.uniqueId();

        this._dimension = undefined;
        this._group = undefined;

        this._anchor = undefined;
        this._root = undefined;
        this._svg = undefined;
        this._isChild = undefined;

        this._minWidth = 200;
        this._widthCalc = this._defaultWidthCalc;

        this._minHeight = 200;
        this._heightCalc = this._defaultHeightCalc;
        this._width = undefined;
        this._height = undefined;
        this._useViewBoxResizing = false;

        this._keyAccessor = pluck('key');
        this._valueAccessor = pluck('value');
        this._label = pluck('key');

        this._ordering = pluck('key');

        this._renderLabel = false;

        // ES6: the following can't be promoted to a member function, as it needs to be => function
        this._title = d => this.keyAccessor()(d) + ': ' + this.valueAccessor()(d);
        this._renderTitle = true;
        this._controlsUseVisibility = false;

        this._transitionDuration = 750;

        this._transitionDelay = 0;

        this._filterPrinter = printers.filters;

        this._mandatoryAttributesList = ['dimension', 'group'];

        this._chartGroup = constants.DEFAULT_CHART_GROUP;

        this._listeners = d3.dispatch(
            'preRender',
            'postRender',
            'preRedraw',
            'postRedraw',
            'filtered',
            'zoomed',
            'renderlet',
            'pretransition');

        this._legend = undefined;
        this._commitHandler = undefined;

        this._data = this._defaultData;

        this._filters = [];

        this._filterHandler = _defaultFilterHandler;
        this._hasFilterHandler = _defaultHasFilterHandler;
        this._removeFilterHandler = _defaultRemoveFilterHandler;
        this._addFilterHandler = _defaultAddFilterHandler;
        this._resetFilterHandler = _defaultResetFilterHandler;

        // ES6: need to figure out proper way to deprecate

        /**
         * A renderlet is similar to an event listener on rendering event. Multiple renderlets can be added
         * to an individual chart.  Each time a chart is rerendered or redrawn the renderlets are invoked
         * right after the chart finishes its transitions, giving you a way to modify the SVGElements.
         * Renderlet functions take the chart instance as the only input parameter and you can
         * use the dc API or use raw d3 to achieve pretty much any effect.
         *
         * Use {@link dc.baseMixin#on on} with a 'renderlet' prefix.
         * Generates a random key for the renderlet, which makes it hard to remove.
         * @method renderlet
         * @memberof dc.baseMixin
         * @instance
         * @deprecated
         * @example
         * // do this instead of .renderlet(function(chart) { ... })
         * chart.on("renderlet", function(chart){
         *     // mix of dc API and d3 manipulation
         *     chart.select('g.y').style('display', 'none');
         *     // its a closure so you can also access other chart variable available in the closure scope
         *     moveChart.filter(chart.filter());
         * });
         * @param {Function} renderletFunction
         * @returns {dc.baseMixin}
         */
        this.renderlet = logger.deprecate(renderletFunction => {
            this.on('renderlet.' + utils.uniqueId(), renderletFunction);
            return this;
        }, 'chart.renderlet has been deprecated.  Please use chart.on("renderlet.<renderletKey>", renderletFunction)');
    }

    /**
     * Set or get the height attribute of a chart. The height is applied to the SVGElement generated by
     * the chart when rendered (or re-rendered). If a value is given, then it will be used to calculate
     * the new height and the chart returned for method chaining.  The value can either be a numeric, a
     * function, or falsy. If no value is specified then the value of the current height attribute will
     * be returned.
     *
     * By default, without an explicit height being given, the chart will select the width of its
     * anchor element. If that isn't possible it defaults to 200 (provided by the
     * {@link dc.baseMixin#minHeight minHeight} property). Setting the value falsy will return
     * the chart to the default behavior.
     * @method height
     * @memberof dc.baseMixin
     * @instance
     * @see {@link dc.baseMixin#minHeight minHeight}
     * @example
     * // Default height
     * chart.height(function (element) {
     *     var height = element && element.getBoundingClientRect && element.getBoundingClientRect().height;
     *     return (height && height > chart.minHeight()) ? height : chart.minHeight();
     * });
     *
     * chart.height(250); // Set the chart's height to 250px;
     * chart.height(function(anchor) { return doSomethingWith(anchor); }); // set the chart's height with a function
     * chart.height(null); // reset the height to the default auto calculation
     * @param {Number|Function} [height]
     * @returns {Number|dc.baseMixin}
     */
    height (height) {
        if (!arguments.length) {
            if (!utils.isNumber(this._height)) {
                // only calculate once
                this._height = this._heightCalc(this._root.node());
            }
            return this._height;
        }
        this._heightCalc = height ? (typeof height === 'function' ? height : utils.constant(height)) : this._defaultHeightCalc;
        this._height = undefined;
        return this;
    }

    /**
     * Set or get the width attribute of a chart.
     * @method width
     * @memberof dc.baseMixin
     * @instance
     * @see {@link dc.baseMixin#height height}
     * @see {@link dc.baseMixin#minWidth minWidth}
     * @example
     * // Default width
     * chart.width(function (element) {
     *     var width = element && element.getBoundingClientRect && element.getBoundingClientRect().width;
     *     return (width && width > chart.minWidth()) ? width : chart.minWidth();
     * });
     * @param {Number|Function} [width]
     * @returns {Number|dc.baseMixin}
     */
    width (width) {
        if (!arguments.length) {
            if (!utils.isNumber(this._width)) {
                // only calculate once
                this._width = this._widthCalc(this._root.node());
            }
            return this._width;
        }
        this._widthCalc = width ? (typeof width === 'function' ? width : utils.constant(width)) : this._defaultWidthCalc;
        this._width = undefined;
        return this;
    }

    /**
     * Set or get the minimum width attribute of a chart. This only has effect when used with the default
     * {@link dc.baseMixin#width width} function.
     * @method minWidth
     * @memberof dc.baseMixin
     * @instance
     * @see {@link dc.baseMixin#width width}
     * @param {Number} [minWidth=200]
     * @returns {Number|dc.baseMixin}
     */
    minWidth (minWidth) {
        if (!arguments.length) {
            return this._minWidth;
        }
        this._minWidth = minWidth;
        return this;
    }

    /**
     * Set or get the minimum height attribute of a chart. This only has effect when used with the default
     * {@link dc.baseMixin#height height} function.
     * @method minHeight
     * @memberof dc.baseMixin
     * @instance
     * @see {@link dc.baseMixin#height height}
     * @param {Number} [minHeight=200]
     * @returns {Number|dc.baseMixin}
     */
    minHeight (minHeight) {
        if (!arguments.length) {
            return this._minHeight;
        }
        this._minHeight = minHeight;
        return this;
    }

    /**
     * Turn on/off using the SVG
     * {@link https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/viewBox `viewBox` attribute}.
     * When enabled, `viewBox` will be set on the svg root element instead of `width` and `height`.
     * Requires that the chart aspect ratio be defined using chart.width(w) and chart.height(h).
     *
     * This will maintain the aspect ratio while enabling the chart to resize responsively to the
     * space given to the chart using CSS. For example, the chart can use `width: 100%; height:
     * 100%` or absolute positioning to resize to its parent div.
     *
     * Since the text will be sized as if the chart is drawn according to the width and height, and
     * will be resized if the chart is any other size, you need to set the chart width and height so
     * that the text looks good. In practice, 600x400 seems to work pretty well for most charts.
     *
     * You can see examples of this resizing strategy in the [Chart Resizing
     * Examples](http://dc-js.github.io/dc.js/resizing/); just add `?resize=viewbox` to any of the
     * one-chart examples to enable `useViewBoxResizing`.
     * @method useViewBoxResizing
     * @memberof dc.baseMixin
     * @instance
     * @param {Boolean} [useViewBoxResizing=false]
     * @returns {Boolean|dc.baseMixin}
     */
    useViewBoxResizing (useViewBoxResizing) {
        if (!arguments.length) {
            return this._useViewBoxResizing;
        }
        this._useViewBoxResizing = useViewBoxResizing;
        return this;
    }

    /**
     * **mandatory**
     *
     * Set or get the dimension attribute of a chart. In `dc`, a dimension can be any valid
     * {@link https://github.com/crossfilter/crossfilter/wiki/API-Reference#dimension crossfilter dimension}
     *
     * If a value is given, then it will be used as the new dimension. If no value is specified then
     * the current dimension will be returned.
     * @method dimension
     * @memberof dc.baseMixin
     * @instance
     * @see {@link https://github.com/crossfilter/crossfilter/wiki/API-Reference#dimension crossfilter.dimension}
     * @example
     * var index = crossfilter([]);
     * var dimension = index.dimension(dc.pluck('key'));
     * chart.dimension(dimension);
     * @param {crossfilter.dimension} [dimension]
     * @returns {crossfilter.dimension|dc.baseMixin}
     */
    dimension (dimension) {
        if (!arguments.length) {
            return this._dimension;
        }
        this._dimension = dimension;
        this.expireCache();
        return this;
    }

    /**
     * Set the data callback or retrieve the chart's data set. The data callback is passed the chart's
     * group and by default will return
     * {@link https://github.com/crossfilter/crossfilter/wiki/API-Reference#group_all group.all}.
     * This behavior may be modified to, for instance, return only the top 5 groups.
     * @method data
     * @memberof dc.baseMixin
     * @instance
     * @example
     * // Default data function
     * chart.data(function (group) { return group.all(); });
     *
     * chart.data(function (group) { return group.top(5); });
     * @param {Function} [callback]
     * @returns {*|dc.baseMixin}
     */
    data (callback) {
        if (!arguments.length) {
            return this._data.call(this, this._group);
        }
        this._data = typeof callback === 'function' ? callback : utils.constant(callback);
        this.expireCache();
        return this;
    }

    /**
     * **mandatory**
     *
     * Set or get the group attribute of a chart. In `dc` a group is a
     * {@link https://github.com/crossfilter/crossfilter/wiki/API-Reference#group-map-reduce crossfilter group}.
     * Usually the group should be created from the particular dimension associated with the same chart. If a value is
     * given, then it will be used as the new group.
     *
     * If no value specified then the current group will be returned.
     * If `name` is specified then it will be used to generate legend label.
     * @method group
     * @memberof dc.baseMixin
     * @instance
     * @see {@link https://github.com/crossfilter/crossfilter/wiki/API-Reference#group-map-reduce crossfilter.group}
     * @example
     * var index = crossfilter([]);
     * var dimension = index.dimension(dc.pluck('key'));
     * chart.dimension(dimension);
     * chart.group(dimension.group().reduceSum());
     * @param {crossfilter.group} [group]
     * @param {String} [name]
     * @returns {crossfilter.group|dc.baseMixin}
     */
    group (group, name) {
        if (!arguments.length) {
            return this._group;
        }
        this._group = group;
        this._groupName = name;
        this.expireCache();
        return this;
    }

    /**
     * Get or set an accessor to order ordinal dimensions.  The chart uses
     * {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort Array.sort}
     * to sort elements; this accessor returns the value to order on.
     * @method ordering
     * @memberof dc.baseMixin
     * @instance
     * @example
     * // Default ordering accessor
     * _chart.ordering(dc.pluck('key'));
     * @param {Function} [orderFunction]
     * @returns {Function|dc.baseMixin}
     */
    ordering (orderFunction) {
        if (!arguments.length) {
            return this._ordering;
        }
        this._ordering = orderFunction;
        this.expireCache();
        return this;
    }

    _computeOrderedGroups (data) {
        // clone the array before sorting, otherwise Array.sort sorts in-place
        return Array.from(data).sort((a, b) => this._ordering(a) - this._ordering(b));
    }

    /**
     * Clear all filters associated with this chart. The same effect can be achieved by calling
     * {@link dc.baseMixin#filter chart.filter(null)}.
     * @method filterAll
     * @memberof dc.baseMixin
     * @instance
     * @returns {dc.baseMixin}
     */
    filterAll () {
        return this.filter(null);
    }

    /**
     * Execute d3 single selection in the chart's scope using the given selector and return the d3
     * selection.
     *
     * This function is **not chainable** since it does not return a chart instance; however the d3
     * selection result can be chained to d3 function calls.
     * @method select
     * @memberof dc.baseMixin
     * @instance
     * @see {@link https://github.com/d3/d3-selection/blob/master/README.md#select d3.select}
     * @example
     * // Has the same effect as d3.select('#chart-id').select(selector)
     * chart.select(selector)
     * @param {String} sel CSS selector string
     * @returns {d3.selection}
     */
    select (sel) {
        return this._root.select(sel);
    }

    /**
     * Execute in scope d3 selectAll using the given selector and return d3 selection result.
     *
     * This function is **not chainable** since it does not return a chart instance; however the d3
     * selection result can be chained to d3 function calls.
     * @method selectAll
     * @memberof dc.baseMixin
     * @instance
     * @see {@link https://github.com/d3/d3-selection/blob/master/README.md#selectAll d3.selectAll}
     * @example
     * // Has the same effect as d3.select('#chart-id').selectAll(selector)
     * chart.selectAll(selector)
     * @param {String} sel CSS selector string
     * @returns {d3.selection}
     */
    selectAll (sel) {
        return this._root ? this._root.selectAll(sel) : null;
    }

    /**
     * Set the root SVGElement to either be an existing chart's root; or any valid [d3 single
     * selector](https://github.com/d3/d3-selection/blob/master/README.md#selecting-elements) specifying a dom
     * block element such as a div; or a dom element or d3 selection. Optionally registers the chart
     * within the chartGroup. This class is called internally on chart initialization, but be called
     * again to relocate the chart. However, it will orphan any previously created SVGElements.
     * @method anchor
     * @memberof dc.baseMixin
     * @instance
     * @param {anchorChart|anchorSelector|anchorNode} [parent]
     * @param {String} [chartGroup]
     * @returns {String|node|d3.selection|dc.baseMixin}
     */
    anchor (parent, chartGroup) {
        if (!arguments.length) {
            return this._anchor;
        }
        if (instanceOfChart(parent)) {
            this._anchor = parent.anchor();
            if (this._anchor.children) { // is _anchor a div?
                this._anchor = '#' + parent.anchorName();
            }
            this._root = parent.root();
            this._isChild = true;
        } else if (parent) {
            if (parent.select && parent.classed) { // detect d3 selection
                this._anchor = parent.node();
            } else {
                this._anchor = parent;
            }
            this._root = d3.select(this._anchor);
            this._root.classed(constants.CHART_CLASS, true);
            registerChart(this, chartGroup);
            this._isChild = false;
        } else {
            throw new BadArgumentException('parent must be defined');
        }
        this._chartGroup = chartGroup;
        return this;
    }

    /**
     * Returns the DOM id for the chart's anchored location.
     * @method anchorName
     * @memberof dc.baseMixin
     * @instance
     * @returns {String}
     */
    anchorName () {
        const a = this.anchor();
        if (a && a.id) {
            return a.id;
        }
        if (a && a.replace) {
            return a.replace('#', '');
        }
        return 'dc-chart' + this.chartID();
    }

    /**
     * Returns the root element where a chart resides. Usually it will be the parent div element where
     * the SVGElement was created. You can also pass in a new root element however this is usually handled by
     * dc internally. Resetting the root element on a chart outside of dc internals may have
     * unexpected consequences.
     * @method root
     * @memberof dc.baseMixin
     * @instance
     * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement HTMLElement}
     * @param {HTMLElement} [rootElement]
     * @returns {HTMLElement|dc.baseMixin}
     */
    root (rootElement) {
        if (!arguments.length) {
            return this._root;
        }
        this._root = rootElement;
        return this;
    }

    /**
     * Returns the top SVGElement for this specific chart. You can also pass in a new SVGElement,
     * however this is usually handled by dc internally. Resetting the SVGElement on a chart outside
     * of dc internals may have unexpected consequences.
     * @method svg
     * @memberof dc.baseMixin
     * @instance
     * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/SVGElement SVGElement}
     * @param {SVGElement|d3.selection} [svgElement]
     * @returns {SVGElement|d3.selection|dc.baseMixin}
     */
    svg (svgElement) {
        if (!arguments.length) {
            return this._svg;
        }
        this._svg = svgElement;
        return this;
    }

    /**
     * Remove the chart's SVGElements from the dom and recreate the container SVGElement.
     * @method resetSvg
     * @memberof dc.baseMixin
     * @instance
     * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/SVGElement SVGElement}
     * @returns {SVGElement}
     */
    resetSvg () {
        this.select('svg').remove();
        return this.generateSvg();
    }

    sizeSvg () {
        if (this._svg) {
            if (!this._useViewBoxResizing) {
                this._svg
                    .attr('width', this.width())
                    .attr('height', this.height());
            } else if (!this._svg.attr('viewBox')) {
                this._svg
                    .attr('viewBox', '0 0 ' + this.width() + ' ' + this.height());
            }
        }
    }

    generateSvg () {
        this._svg = this.root().append('svg');
        this.sizeSvg();
        return this._svg;
    }

    /**
     * Set or get the filter printer function. The filter printer function is used to generate human
     * friendly text for filter value(s) associated with the chart instance. The text will get shown
     * in the `.filter element; see {@link dc.baseMixin#turnOnControls turnOnControls}.
     *
     * By default dc charts use a default filter printer {@link dc.printers.filters dc.printers.filters}
     * that provides simple printing support for both single value and ranged filters.
     * @method filterPrinter
     * @memberof dc.baseMixin
     * @instance
     * @example
     * // for a chart with an ordinal brush, print the filters in upper case
     * chart.filterPrinter(function(filters) {
     *   return filters.map(function(f) { return f.toUpperCase(); }).join(', ');
     * });
     * // for a chart with a range brush, print the filter as start and extent
     * chart.filterPrinter(function(filters) {
     *   return 'start ' + dc.utils.printSingleValue(filters[0][0]) +
     *     ' extent ' + dc.utils.printSingleValue(filters[0][1] - filters[0][0]);
     * });
     * @param {Function} [filterPrinterFunction=dc.printers.filters]
     * @returns {Function|dc.baseMixin}
     */
    filterPrinter (filterPrinterFunction) {
        if (!arguments.length) {
            return this._filterPrinter;
        }
        this._filterPrinter = filterPrinterFunction;
        return this;
    }

    /**
     * If set, use the `visibility` attribute instead of the `display` attribute for showing/hiding
     * chart reset and filter controls, for less disruption to the layout.
     * @method controlsUseVisibility
     * @memberof dc.baseMixin
     * @instance
     * @param {Boolean} [controlsUseVisibility=false]
     * @returns {Boolean|dc.baseMixin}
     **/
    controlsUseVisibility (controlsUseVisibility) {
        if (!arguments.length) {
            return this._controlsUseVisibility;
        }
        this._controlsUseVisibility = controlsUseVisibility;
        return this;
    }

    /**
     * Turn on optional control elements within the root element. dc currently supports the
     * following html control elements.
     * * root.selectAll('.reset') - elements are turned on if the chart has an active filter. This type
     * of control element is usually used to store a reset link to allow user to reset filter on a
     * certain chart. This element will be turned off automatically if the filter is cleared.
     * * root.selectAll('.filter') elements are turned on if the chart has an active filter. The text
     * content of this element is then replaced with the current filter value using the filter printer
     * function. This type of element will be turned off automatically if the filter is cleared.
     * @method turnOnControls
     * @memberof dc.baseMixin
     * @instance
     * @returns {dc.baseMixin}
     */
    turnOnControls () {
        if (this._root) {
            const attribute = this.controlsUseVisibility() ? 'visibility' : 'display';
            this.selectAll('.reset').style(attribute, null);
            this.selectAll('.filter').text(this._filterPrinter(this.filters())).style(attribute, null);
        }
        return this;
    }

    /**
     * Turn off optional control elements within the root element.
     * @method turnOffControls
     * @memberof dc.baseMixin
     * @see {@link dc.baseMixin#turnOnControls turnOnControls}
     * @instance
     * @returns {dc.baseMixin}
     */
    turnOffControls () {
        if (this._root) {
            const attribute = this.controlsUseVisibility() ? 'visibility' : 'display';
            const value = this.controlsUseVisibility() ? 'hidden' : 'none';
            this.selectAll('.reset').style(attribute, value);
            this.selectAll('.filter').style(attribute, value).text(this.filter());
        }
        return this;
    }

    /**
     * Set or get the animation transition duration (in milliseconds) for this chart instance.
     * @method transitionDuration
     * @memberof dc.baseMixin
     * @instance
     * @param {Number} [duration=750]
     * @returns {Number|dc.baseMixin}
     */
    transitionDuration (duration) {
        if (!arguments.length) {
            return this._transitionDuration;
        }
        this._transitionDuration = duration;
        return this;
    }

    /**
     * Set or get the animation transition delay (in milliseconds) for this chart instance.
     * @method transitionDelay
     * @memberof dc.baseMixin
     * @instance
     * @param {Number} [delay=0]
     * @returns {Number|dc.baseMixin}
     */
    transitionDelay (delay) {
        if (!arguments.length) {
            return this._transitionDelay;
        }
        this._transitionDelay = delay;
        return this;
    }

    _mandatoryAttributes (_) {
        if (!arguments.length) {
            return this._mandatoryAttributesList;
        }
        this._mandatoryAttributesList = _;
        return this;
    }

    checkForMandatoryAttributes (a) {
        if (!this[a] || !this[a]()) {
            throw new InvalidStateException('Mandatory attribute chart.' + a +
                ' is missing on chart[#' + this.anchorName() + ']');
        }
    }

    /**
     * Invoking this method will force the chart to re-render everything from scratch. Generally it
     * should only be used to render the chart for the first time on the page or if you want to make
     * sure everything is redrawn from scratch instead of relying on the default incremental redrawing
     * behaviour.
     * @method render
     * @memberof dc.baseMixin
     * @instance
     * @returns {dc.baseMixin}
     */
    render () {
        this._height = this._width = undefined; // force recalculate
        this._listeners.call('preRender', this, this);

        if (this._mandatoryAttributesList) {
            this._mandatoryAttributesList.forEach((e) => this.checkForMandatoryAttributes(e));
        }

        const result = this._doRender();

        if (this._legend) {
            this._legend.render();
        }

        this._activateRenderlets('postRender');

        return result;
    }

    _activateRenderlets (event) {
        this._listeners.call('pretransition', this, this);
        if (this.transitionDuration() > 0 && this._svg) {
            this._svg.transition().duration(this.transitionDuration()).delay(this.transitionDelay())
                .on('end', () => {
                    this._listeners.call('renderlet', this, this);
                    if (event) {
                        this._listeners.call(event, this, this);
                    }
                });
        } else {
            this._listeners.call('renderlet', this, this);
            if (event) {
                this._listeners.call(event, this, this);
            }
        }
    }

    /**
     * Calling redraw will cause the chart to re-render data changes incrementally. If there is no
     * change in the underlying data dimension then calling this method will have no effect on the
     * chart. Most chart interaction in dc will automatically trigger this method through internal
     * events (in particular {@link dc.redrawAll dc.redrawAll}); therefore, you only need to
     * manually invoke this function if data is manipulated outside of dc's control (for example if
     * data is loaded in the background using
     * {@link https://github.com/crossfilter/crossfilter/wiki/API-Reference#crossfilter_add crossfilter.add}).
     * @method redraw
     * @memberof dc.baseMixin
     * @instance
     * @returns {dc.baseMixin}
     */
    redraw () {
        this.sizeSvg();
        this._listeners.call('preRedraw', this, this);

        const result = this._doRedraw();

        if (this._legend) {
            this._legend.render();
        }

        this._activateRenderlets('postRedraw');

        return result;
    }

    /**
     * Gets/sets the commit handler. If the chart has a commit handler, the handler will be called when
     * the chart's filters have changed, in order to send the filter data asynchronously to a server.
     *
     * Unlike other functions in dc.js, the commit handler is asynchronous. It takes two arguments:
     * a flag indicating whether this is a render (true) or a redraw (false), and a callback to be
     * triggered once the commit is done. The callback has the standard node.js continuation signature
     * with error first and result second.
     * @method commitHandler
     * @param {Function} commitHandler
     * @memberof dc.baseMixin
     * @instance
     * @returns {dc.baseMixin}
     */
    commitHandler (commitHandler) {
        if (!arguments.length) {
            return this._commitHandler;
        }
        this._commitHandler = commitHandler;
        return this;
    }

    /**
     * Redraws all charts in the same group as this chart, typically in reaction to a filter
     * change. If the chart has a {@link dc.baseMixin.commitFilter commitHandler}, it will
     * be executed and waited for.
     * @method redrawGroup
     * @memberof dc.baseMixin
     * @instance
     * @returns {dc.baseMixin}
     */
    redrawGroup () {
        if (this._commitHandler) {
            this._commitHandler(false, (error, result) => {
                if (error) {
                    console.log(error);
                } else {
                    redrawAll(this.chartGroup());
                }
            });
        } else {
            redrawAll(this.chartGroup());
        }
        return this;
    }

    /**
     * Renders all charts in the same group as this chart. If the chart has a
     * {@link dc.baseMixin.commitFilter commitHandler}, it will be executed and waited for
     * @method renderGroup
     * @memberof dc.baseMixin
     * @instance
     * @returns {dc.baseMixin}
     */
    renderGroup () {
        if (this._commitHandler) {
            this._commitHandler(false, (error, result) => {
                if (error) {
                    console.log(error);
                } else {
                    renderAll(this.chartGroup());
                }
            });
        } else {
            renderAll(this.chartGroup());
        }
        return this;
    }

    _invokeFilteredListener (f) {
        if (f !== undefined) {
            this._listeners.call('filtered', this, this, f);
        }
    }

    _invokeZoomedListener () {
        this._listeners.call('zoomed', this, this);
    }

    /**
     * Set or get the has-filter handler. The has-filter handler is a function that checks to see if
     * the chart's current filters (first argument) include a specific filter (second argument).  Using a custom has-filter handler allows
     * you to change the way filters are checked for and replaced.
     * @method hasFilterHandler
     * @memberof dc.baseMixin
     * @instance
     * @example
     * // default has-filter handler
     * chart.hasFilterHandler(function (filters, filter) {
     *     if (filter === null || typeof(filter) === 'undefined') {
     *         return filters.length > 0;
     *     }
     *     return filters.some(function (f) {
     *         return filter <= f && filter >= f;
     *     });
     * });
     *
     * // custom filter handler (no-op)
     * chart.hasFilterHandler(function(filters, filter) {
     *     return false;
     * });
     * @param {Function} [hasFilterHandler]
     * @returns {Function|dc.baseMixin}
     */
    hasFilterHandler (hasFilterHandler) {
        if (!arguments.length) {
            return this._hasFilterHandler;
        }
        this._hasFilterHandler = hasFilterHandler;
        return this;
    }

    /**
     * Check whether any active filter or a specific filter is associated with particular chart instance.
     * This function is **not chainable**.
     * @method hasFilter
     * @memberof dc.baseMixin
     * @instance
     * @see {@link dc.baseMixin#hasFilterHandler hasFilterHandler}
     * @param {*} [filter]
     * @returns {Boolean}
     */
    hasFilter (filter) {
        return this._hasFilterHandler(this._filters, filter);
    }

    /**
     * Set or get the remove filter handler. The remove filter handler is a function that removes a
     * filter from the chart's current filters. Using a custom remove filter handler allows you to
     * change how filters are removed or perform additional work when removing a filter, e.g. when
     * using a filter server other than crossfilter.
     *
     * The handler should return a new or modified array as the result.
     * @method removeFilterHandler
     * @memberof dc.baseMixin
     * @instance
     * @example
     * // default remove filter handler
     * chart.removeFilterHandler(function (filters, filter) {
     *     for (var i = 0; i < filters.length; i++) {
     *         if (filters[i] <= filter && filters[i] >= filter) {
     *             filters.splice(i, 1);
     *             break;
     *         }
     *     }
     *     return filters;
     * });
     *
     * // custom filter handler (no-op)
     * chart.removeFilterHandler(function(filters, filter) {
     *     return filters;
     * });
     * @param {Function} [removeFilterHandler]
     * @returns {Function|dc.baseMixin}
     */
    removeFilterHandler (removeFilterHandler) {
        if (!arguments.length) {
            return this._removeFilterHandler;
        }
        this._removeFilterHandler = removeFilterHandler;
        return this;
    }

    /**
     * Set or get the add filter handler. The add filter handler is a function that adds a filter to
     * the chart's filter list. Using a custom add filter handler allows you to change the way filters
     * are added or perform additional work when adding a filter, e.g. when using a filter server other
     * than crossfilter.
     *
     * The handler should return a new or modified array as the result.
     * @method addFilterHandler
     * @memberof dc.baseMixin
     * @instance
     * @example
     * // default add filter handler
     * chart.addFilterHandler(function (filters, filter) {
     *     filters.push(filter);
     *     return filters;
     * });
     *
     * // custom filter handler (no-op)
     * chart.addFilterHandler(function(filters, filter) {
     *     return filters;
     * });
     * @param {Function} [addFilterHandler]
     * @returns {Function|dc.baseMixin}
     */
    addFilterHandler (addFilterHandler) {
        if (!arguments.length) {
            return this._addFilterHandler;
        }
        this._addFilterHandler = addFilterHandler;
        return this;
    }

    /**
     * Set or get the reset filter handler. The reset filter handler is a function that resets the
     * chart's filter list by returning a new list. Using a custom reset filter handler allows you to
     * change the way filters are reset, or perform additional work when resetting the filters,
     * e.g. when using a filter server other than crossfilter.
     *
     * The handler should return a new or modified array as the result.
     * @method resetFilterHandler
     * @memberof dc.baseMixin
     * @instance
     * @example
     * // default remove filter handler
     * function (filters) {
     *     return [];
     * }
     *
     * // custom filter handler (no-op)
     * chart.resetFilterHandler(function(filters) {
     *     return filters;
     * });
     * @param {Function} [resetFilterHandler]
     * @returns {dc.baseMixin}
     */
    resetFilterHandler (resetFilterHandler) {
        if (!arguments.length) {
            return this._resetFilterHandler;
        }
        this._resetFilterHandler = resetFilterHandler;
        return this;
    }

    applyFilters (filters) {
        if (this.dimension() && this.dimension().filter) {
            const fs = this._filterHandler(this.dimension(), filters);
            if (fs) {
                filters = fs;
            }
        }
        return filters;
    }

    /**
     * Replace the chart filter. This is equivalent to calling `chart.filter(null).filter(filter)`
     * but more efficient because the filter is only applied once.
     *
     * @method replaceFilter
     * @memberof dc.baseMixin
     * @instance
     * @param {*} [filter]
     * @returns {dc.baseMixin}
     **/
    replaceFilter (filter) {
        this._filters = this._resetFilterHandler(this._filters);
        this.filter(filter);
        return this;
    }

    /**
     * Filter the chart by the given parameter, or return the current filter if no input parameter
     * is given.
     *
     * The filter parameter can take one of these forms:
     * * A single value: the value will be toggled (added if it is not present in the current
     * filters, removed if it is present)
     * * An array containing a single array of values (`[[value,value,value]]`): each value is
     * toggled
     * * When appropriate for the chart, a {@link dc.filters dc filter object} such as
     *   * {@link dc.filters.RangedFilter `dc.filters.RangedFilter`} for the
     * {@link dc.coordinateGridMixin dc.coordinateGridMixin} charts
     *   * {@link dc.filters.TwoDimensionalFilter `dc.filters.TwoDimensionalFilter`} for the
     * {@link dc.heatMap heat map}
     *   * {@link dc.filters.RangedTwoDimensionalFilter `dc.filters.RangedTwoDimensionalFilter`}
     * for the {@link dc.scatterPlot scatter plot}
     * * `null`: the filter will be reset using the
     * {@link dc.baseMixin#resetFilterHandler resetFilterHandler}
     *
     * Note that this is always a toggle (even when it doesn't make sense for the filter type). If
     * you wish to replace the current filter, either call `chart.filter(null)` first - or it's more
     * efficient to call {@link dc.baseMixin#replaceFilter `chart.replaceFilter(filter)`} instead.
     *
     * Each toggle is executed by checking if the value is already present using the
     * {@link dc.baseMixin#hasFilterHandler hasFilterHandler}; if it is not present, it is added
     * using the {@link dc.baseMixin#addFilterHandler addFilterHandler}; if it is already present,
     * it is removed using the {@link dc.baseMixin#removeFilterHandler removeFilterHandler}.
     *
     * Once the filters array has been updated, the filters are applied to the
     * crossfilter dimension, using the {@link dc.baseMixin#filterHandler filterHandler}.
     *
     * Once you have set the filters, call {@link dc.baseMixin#redrawGroup `chart.redrawGroup()`}
     * (or {@link dc.redrawAll `dc.redrawAll()`}) to redraw the chart's group.
     * @method filter
     * @memberof dc.baseMixin
     * @instance
     * @see {@link dc.baseMixin#addFilterHandler addFilterHandler}
     * @see {@link dc.baseMixin#removeFilterHandler removeFilterHandler}
     * @see {@link dc.baseMixin#resetFilterHandler resetFilterHandler}
     * @see {@link dc.baseMixin#filterHandler filterHandler}
     * @example
     * // filter by a single string
     * chart.filter('Sunday');
     * // filter by a single age
     * chart.filter(18);
     * // filter by a set of states
     * chart.filter([['MA', 'TX', 'ND', 'WA']]);
     * // filter by range -- note the use of dc.filters.RangedFilter, which is different
     * // from the syntax for filtering a crossfilter dimension directly, dimension.filter([15,20])
     * chart.filter(dc.filters.RangedFilter(15,20));
     * @param {*} [filter]
     * @returns {dc.baseMixin}
     */
    filter (filter) {
        if (!arguments.length) {
            return this._filters.length > 0 ? this._filters[0] : null;
        }
        let filters = this._filters;
        if (filter instanceof Array && filter[0] instanceof Array && !filter.isFiltered) {
            // toggle each filter
            filter[0].forEach(f => {
                if (this._hasFilterHandler(filters, f)) {
                    filters = this._removeFilterHandler(filters, f);
                } else {
                    filters = this._addFilterHandler(filters, f);
                }
            });
        } else if (filter === null) {
            filters = this._resetFilterHandler(filters);
        } else {
            if (this._hasFilterHandler(filters, filter)) {
                filters = this._removeFilterHandler(filters, filter);
            } else {
                filters = this._addFilterHandler(filters, filter);
            }
        }
        this._filters = this.applyFilters(filters);
        this._invokeFilteredListener(filter);

        if (this._root !== null && this.hasFilter()) {
            this.turnOnControls();
        } else {
            this.turnOffControls();
        }

        return this;
    }

    /**
     * Returns all current filters. This method does not perform defensive cloning of the internal
     * filter array before returning, therefore any modification of the returned array will effect the
     * chart's internal filter storage.
     * @method filters
     * @memberof dc.baseMixin
     * @instance
     * @returns {Array<*>}
     */
    filters () {
        return this._filters;
    }

    highlightSelected (e) {
        d3.select(e).classed(constants.SELECTED_CLASS, true);
        d3.select(e).classed(constants.DESELECTED_CLASS, false);
    }

    fadeDeselected (e) {
        d3.select(e).classed(constants.SELECTED_CLASS, false);
        d3.select(e).classed(constants.DESELECTED_CLASS, true);
    }

    resetHighlight (e) {
        d3.select(e).classed(constants.SELECTED_CLASS, false);
        d3.select(e).classed(constants.DESELECTED_CLASS, false);
    }

    /**
     * This function is passed to d3 as the onClick handler for each chart. The default behavior is to
     * filter on the clicked datum (passed to the callback) and redraw the chart group.
     *
     * This function can be replaced in order to change the click behavior (but first look at
     * @method onClick
     * @memberof dc.baseMixin
     * @instance
     * @example
     * var oldHandler = chart.onClick;
     * chart.onClick = function(datum) {
     *   // use datum.
     * @param {*} datum
     * @return {undefined}
     */
    onClick (datum) {
        const filter = this.keyAccessor()(datum);
        events.trigger(() => {
            this.filter(filter);
            this.redrawGroup();
        });
    }

    /**
     * Set or get the filter handler. The filter handler is a function that performs the filter action
     * on a specific dimension. Using a custom filter handler allows you to perform additional logic
     * before or after filtering.
     * @method filterHandler
     * @memberof dc.baseMixin
     * @instance
     * @see {@link https://github.com/crossfilter/crossfilter/wiki/API-Reference#dimension_filter crossfilter.dimension.filter}
     * @example
     * // the default filter handler handles all possible cases for the charts in dc.js
     * // you can replace it with something more specialized for your own chart
     * chart.filterHandler(function (dimension, filters) {
     *     if (filters.length === 0) {
     *         // the empty case (no filtering)
     *         dimension.filter(null);
     *     } else if (filters.length === 1 && !filters[0].isFiltered) {
     *         // single value and not a function-based filter
     *         dimension.filterExact(filters[0]);
     *     } else if (filters.length === 1 && filters[0].filterType === 'RangedFilter') {
     *         // single range-based filter
     *         dimension.filterRange(filters[0]);
     *     } else {
     *         // an array of values, or an array of filter objects
     *         dimension.filterFunction(function (d) {
     *             for (var i = 0; i < filters.length; i++) {
     *                 var filter = filters[i];
     *                 if (filter.isFiltered && filter.isFiltered(d)) {
     *                     return true;
     *                 } else if (filter <= d && filter >= d) {
     *                     return true;
     *                 }
     *             }
     *             return false;
     *         });
     *     }
     *     return filters;
     * });
     *
     * // custom filter handler
     * chart.filterHandler(function(dimension, filter){
     *     var newFilter = filter + 10;
     *     dimension.filter(newFilter);
     *     return newFilter; // set the actual filter value to the new value
     * });
     * @param {Function} [filterHandler]
     * @returns {Function|dc.baseMixin}
     */
    filterHandler (filterHandler) {
        if (!arguments.length) {
            return this._filterHandler;
        }
        this._filterHandler = filterHandler;
        return this;
    }

    // abstract function stub
    _doRender () {
        // do nothing in base, should be overridden by sub-function
        return this;
    }

    _doRedraw () {
        // do nothing in base, should be overridden by sub-function
        return this;
    }

    legendables () {
        // do nothing in base, should be overridden by sub-function
        return [];
    }

    legendHighlight () {
        // do nothing in base, should be overridden by sub-function
    }

    legendReset () {
        // do nothing in base, should be overridden by sub-function
    }

    legendToggle () {
        // do nothing in base, should be overriden by sub-function
    }

    isLegendableHidden () {
        // do nothing in base, should be overridden by sub-function
        return false;
    }

    /**
     * Set or get the key accessor function. The key accessor function is used to retrieve the key
     * value from the crossfilter group. Key values are used differently in different charts, for
     * example keys correspond to slices in a pie chart and x axis positions in a grid coordinate chart.
     * @method keyAccessor
     * @memberof dc.baseMixin
     * @instance
     * @example
     * // default key accessor
     * chart.keyAccessor(function(d) { return d.key; });
     * // custom key accessor for a multi-value crossfilter reduction
     * chart.keyAccessor(function(p) { return p.value.absGain; });
     * @param {Function} [keyAccessor]
     * @returns {Function|dc.baseMixin}
     */
    keyAccessor (keyAccessor) {
        if (!arguments.length) {
            return this._keyAccessor;
        }
        this._keyAccessor = keyAccessor;
        return this;
    }

    /**
     * Set or get the value accessor function. The value accessor function is used to retrieve the
     * value from the crossfilter group. Group values are used differently in different charts, for
     * example values correspond to slice sizes in a pie chart and y axis positions in a grid
     * coordinate chart.
     * @method valueAccessor
     * @memberof dc.baseMixin
     * @instance
     * @example
     * // default value accessor
     * chart.valueAccessor(function(d) { return d.value; });
     * // custom value accessor for a multi-value crossfilter reduction
     * chart.valueAccessor(function(p) { return p.value.percentageGain; });
     * @param {Function} [valueAccessor]
     * @returns {Function|dc.baseMixin}
     */
    valueAccessor (valueAccessor) {
        if (!arguments.length) {
            return this._valueAccessor;
        }
        this._valueAccessor = valueAccessor;
        return this;
    }

    /**
     * Set or get the label function. The chart class will use this function to render labels for each
     * child element in the chart, e.g. slices in a pie chart or bubbles in a bubble chart. Not every
     * chart supports the label function, for example line chart does not use this function
     * at all. By default, enables labels; pass false for the second parameter if this is not desired.
     * @method label
     * @memberof dc.baseMixin
     * @instance
     * @example
     * // default label function just return the key
     * chart.label(function(d) { return d.key; });
     * // label function has access to the standard d3 data binding and can get quite complicated
     * chart.label(function(d) { return d.data.key + '(' + Math.floor(d.data.value / all.value() * 100) + '%)'; });
     * @param {Function} [labelFunction]
     * @param {Boolean} [enableLabels=true]
     * @returns {Function|dc.baseMixin}
     */
    label (labelFunction, enableLabels) {
        if (!arguments.length) {
            return this._label;
        }
        this._label = labelFunction;
        if ((enableLabels === undefined) || enableLabels) {
            this._renderLabel = true;
        }
        return this;
    }

    /**
     * Turn on/off label rendering
     * @method renderLabel
     * @memberof dc.baseMixin
     * @instance
     * @param {Boolean} [renderLabel=false]
     * @returns {Boolean|dc.baseMixin}
     */
    renderLabel (renderLabel) {
        if (!arguments.length) {
            return this._renderLabel;
        }
        this._renderLabel = renderLabel;
        return this;
    }

    /**
     * Set or get the title function. The chart class will use this function to render the SVGElement title
     * (usually interpreted by browser as tooltips) for each child element in the chart, e.g. a slice
     * in a pie chart or a bubble in a bubble chart. Almost every chart supports the title function;
     * however in grid coordinate charts you need to turn off the brush in order to see titles, because
     * otherwise the brush layer will block tooltip triggering.
     * @method title
     * @memberof dc.baseMixin
     * @instance
     * @example
     * // default title function shows "key: value"
     * chart.title(function(d) { return d.key + ': ' + d.value; });
     * // title function has access to the standard d3 data binding and can get quite complicated
     * chart.title(function(p) {
     *    return p.key.getFullYear()
     *        + '\n'
     *        + 'Index Gain: ' + numberFormat(p.value.absGain) + '\n'
     *        + 'Index Gain in Percentage: ' + numberFormat(p.value.percentageGain) + '%\n'
     *        + 'Fluctuation / Index Ratio: ' + numberFormat(p.value.fluctuationPercentage) + '%';
     * });
     * @param {Function} [titleFunction]
     * @returns {Function|dc.baseMixin}
     */
    title (titleFunction) {
        if (!arguments.length) {
            return this._title;
        }
        this._title = titleFunction;
        return this;
    }

    /**
     * Turn on/off title rendering, or return the state of the render title flag if no arguments are
     * given.
     * @method renderTitle
     * @memberof dc.baseMixin
     * @instance
     * @param {Boolean} [renderTitle=true]
     * @returns {Boolean|dc.baseMixin}
     */
    renderTitle (renderTitle) {
        if (!arguments.length) {
            return this._renderTitle;
        }
        this._renderTitle = renderTitle;
        return this;
    }

    /**
     * Get or set the chart group to which this chart belongs. Chart groups are rendered or redrawn
     * together since it is expected they share the same underlying crossfilter data set.
     * @method chartGroup
     * @memberof dc.baseMixin
     * @instance
     * @param {String} [chartGroup]
     * @returns {String|dc.baseMixin}
     */
    chartGroup (chartGroup) {
        if (!arguments.length) {
            return this._chartGroup;
        }
        if (!this._isChild) {
            deregisterChart(this, this._chartGroup);
        }
        this._chartGroup = chartGroup;
        if (!this._isChild) {
            registerChart(this, this._chartGroup);
        }
        return this;
    }

    /**
     * Expire the internal chart cache. dc charts cache some data internally on a per chart basis to
     * speed up rendering and avoid unnecessary calculation; however it might be useful to clear the
     * cache if you have changed state which will affect rendering.  For example, if you invoke
     * {@link https://github.com/crossfilter/crossfilter/wiki/API-Reference#crossfilter_add crossfilter.add}
     * function or reset group or dimension after rendering, it is a good idea to
     * clear the cache to make sure charts are rendered properly.
     * @method expireCache
     * @memberof dc.baseMixin
     * @instance
     * @returns {dc.baseMixin}
     */
    expireCache () {
        // do nothing in base, should be overridden by sub-function
        return this;
    }

    /**
     * Attach a dc.legend widget to this chart. The legend widget will automatically draw legend labels
     * based on the color setting and names associated with each group.
     * @method legend
     * @memberof dc.baseMixin
     * @instance
     * @example
     * chart.legend(dc.legend().x(400).y(10).itemHeight(13).gap(5))
     * @param {dc.legend} [legend]
     * @returns {dc.legend|dc.baseMixin}
     */
    legend (legend) {
        if (!arguments.length) {
            return this._legend;
        }
        this._legend = legend;
        this._legend.parent(this);
        return this;
    }

    /**
     * Returns the internal numeric ID of the chart.
     * @method chartID
     * @memberof dc.baseMixin
     * @instance
     * @returns {String}
     */
    chartID () {
        return this.__dcFlag__;
    }

    /**
     * Set chart options using a configuration object. Each key in the object will cause the method of
     * the same name to be called with the value to set that attribute for the chart.
     * @method options
     * @memberof dc.baseMixin
     * @instance
     * @example
     * chart.options({dimension: myDimension, group: myGroup});
     * @param {{}} opts
     * @returns {dc.baseMixin}
     */
    options (opts) {
        const applyOptions = [
            'anchor',
            'group',
            'xAxisLabel',
            'yAxisLabel',
            'stack',
            'title',
            'point',
            'getColor',
            'overlayGeoJson'
        ];

        for (let o in opts) {
            if (typeof (this[o]) === 'function') {
                if (opts[o] instanceof Array && applyOptions.indexOf(o) !== -1) {
                    this[o].apply(this, opts[o]);
                } else {
                    this[o].call(this, opts[o]);
                }
            } else {
                logger.debug('Not a valid option setter name: ' + o);
            }
        }
        return this;
    }

    /**
     * All dc chart instance supports the following listeners.
     * Supports the following events:
     * * `renderlet` - This listener function will be invoked after transitions after redraw and render. Replaces the
     * deprecated {@link dc.baseMixin#renderlet renderlet} method.
     * * `pretransition` - Like `.on('renderlet', ...)` but the event is fired before transitions start.
     * * `preRender` - This listener function will be invoked before chart rendering.
     * * `postRender` - This listener function will be invoked after chart finish rendering including
     * all renderlets' logic.
     * * `preRedraw` - This listener function will be invoked before chart redrawing.
     * * `postRedraw` - This listener function will be invoked after chart finish redrawing
     * including all renderlets' logic.
     * * `filtered` - This listener function will be invoked after a filter is applied, added or removed.
     * * `zoomed` - This listener function will be invoked after a zoom is triggered.
     * @method on
     * @memberof dc.baseMixin
     * @instance
     * @see {@link https://github.com/d3/d3-dispatch/blob/master/README.md#dispatch_on d3.dispatch.on}
     * @example
     * .on('renderlet', function(chart, filter){...})
     * .on('pretransition', function(chart, filter){...})
     * .on('preRender', function(chart){...})
     * .on('postRender', function(chart){...})
     * .on('preRedraw', function(chart){...})
     * .on('postRedraw', function(chart){...})
     * .on('filtered', function(chart, filter){...})
     * .on('zoomed', function(chart, filter){...})
     * @param {String} event
     * @param {Function} listener
     * @returns {dc.baseMixin}
     */
    on (event, listener) {
        this._listeners.on(event, listener);
        return this;
    }

    _defaultWidthCalc (element) {
        const width = element && element.getBoundingClientRect && element.getBoundingClientRect().width;
        return (width && width > this._minWidth) ? width : this._minWidth;
    }

    _defaultHeightCalc (element) {
        const height = element && element.getBoundingClientRect && element.getBoundingClientRect().height;
        return (height && height > this._minHeight) ? height : this._minHeight;
    }

    _defaultData (group) {
        return group.all();
    }
}

export const baseMixin = () => new BaseMixin();
