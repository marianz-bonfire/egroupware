import {html, LitElement, nothing, PropertyValues, TemplateResult} from "lit";
import {customElement} from "lit/decorators/custom-element.js";
import {property} from "lit/decorators/property.js";
import {state} from "lit/decorators/state.js";
import {unsafeHTML} from "lit/directives/unsafe-html.js";
import shoelace from "../Styles/shoelace";
import {Et2Widget} from "../Et2Widget/Et2Widget";
import {Et2Template} from "../Et2Template/Et2Template";
import styles from "./Et2Datagrid.styles";
import {
	Et2DatagridColumn,
	Et2DatagridDataProvider,
	Et2DatagridRow,
	Et2DatagridSelectionDetail,
	Et2DatagridSelectionMode,
	Et2DatagridTemplateData
} from "./Et2Datagrid.types";
import {styleMap} from "lit/directives/style-map.js";

@customElement("et2-datagrid")
export class Et2Datagrid extends Et2Widget(LitElement)
{
	/**
	 * Compose datagrid styles from shared shoelace/widget styles and local datagrid CSS.
	 */
	static get styles()
	{
		return [
			shoelace,
			super.styles,
			styles
		];
	}

	@property({attribute: false})
	columns : Et2DatagridColumn[] = [];

	@property({attribute: false})
	dataProvider : Et2DatagridDataProvider | null = null;

	@property({attribute: false})
	templateData : Et2DatagridTemplateData | null = null;

	@property({type: Number})
	pageSize : number = 50;

	@property({type: String, attribute: "selection-mode"})
	selectionMode : Et2DatagridSelectionMode = "multiple";

	@property({type: Boolean})
	noColumnSelection: boolean=false;

	@property({type: Boolean, attribute: "require-template"})
	requireTemplate : boolean = false;

	@property({type: Boolean, attribute: "configuration-loading"})
	configurationLoading : boolean = false;

	@state()
	loading : boolean = false;

	@state()
	fetching : boolean = false;

	@state()
	total : number | null = null;

	@state()
	rows : Et2DatagridRow[] = [];

	@state()
	fetchFailed : boolean = false;

	@state()
	fetchErrorMessage : string = "";

	@state()
	private _hasFetchedOnce : boolean = false;

	@state()
	private _pendingPlaceholderCount : number = 0;

	private observer : IntersectionObserver | null = null;
	private displayedRowIds : Set<string> = new Set();
	private selectedRowIds : Set<string> = new Set();
	private anchorRowIndex : number = -1;
	private activeRowIndex : number = -1;
	private activeRowId : string | null = null;
	private _rowHeightPx : number | null = null;
	private _rowHeightLocked : boolean = false;
	private _scrollListener : (() => void) | null = null;


	/**
	 * A fake list-looking SVG that looks like the grid is working
	 */
	private _et2LoadingTemplate() : TemplateResult
	{
		// Use a fake list loader
		return  html`
			<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none"
				 xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
				<style>
					.header {
						fill: var(--sl-color-neutral-100, #e8e8e8);
					}

					.body {
						fill: var(--sl-color-neutral-0, #ffffff);
					}

					.line {
						stroke: var(--sl-color-neutral-200, rgba(0, 0, 0, 0.08));
						stroke-width: 0.15;
						vector-effect: non-scaling-stroke;
					}
				</style>

				<!-- Wipe animation
				<defs>
					<linearGradient id="shimmer" x1="-1" y1="0" x2="0" y2="0">
						<stop offset="0%" stop-color="transparent"></stop>
						<stop offset="35%" stop-color="transparent"></stop>
						<stop offset="50%" stop-color="var(--sl-color-gray-50)"
							  stop-opacity="0.45"></stop>
						<stop offset="65%" stop-color="transparent"></stop>
						<stop offset="100%" stop-color="transparent"></stop>

						<animateTransform attributeName="gradientTransform" type="translate" from="-1 0" to="2 0"
										  dur="2.2s" repeatCount="indefinite"></animateTransform>
					</linearGradient>
				</defs>
				-->

				<!-- background -->
				<rect class="body" width="100%" height="100%"></rect>

				<!-- header -->
				<rect class="header" width="100%" height="6.5%"></rect>

				<!-- 15 row separators -->
				<g class="line">
					<line x1="0%" y1="12.9%" x2="100%" y2="12.9%"></line>
					<line x1="0%" y1="19.3%" x2="100%" y2="19.3%"></line>
					<line x1="0%" y1="25.7%" x2="100%" y2="25.7%"></line>
					<line x1="0%" y1="32.1%" x2="100%" y2="32.1%"></line>
					<line x1="0%" y1="38.5%" x2="100%" y2="38.5%"></line>
					<line x1="0%" y1="44.9%" x2="100%" y2="44.9%"></line>
					<line x1="0%" y1="51.3%" x2="100%" y2="51.3%"></line>
					<line x1="0%" y1="57.7%" x2="100%" y2="57.7%"></line>
					<line x1="0%" y1="64.1%" x2="100%" y2="64.1%"></line>
					<line x1="0%" y1="70.5%" x2="100%" y2="70.5%"></line>
					<line x1="0%" y1="76.9%" x2="100%" y2="76.9%"></line>
					<line x1="0%" y1="83.3%" x2="100%" y2="83.3%"></line>
					<line x1="0%" y1="89.7%" x2="100%" y2="89.7%"></line>
					<line x1="0%" y1="96.1%" x2="100%" y2="96.1%"></line>
				</g>

				<!-- shimmer overlay -->
				<rect x="0" y="6.5%" width="100%" height="93.5%" fill="url(#shimmer)"></rect>
			</svg>
		`;
	}

	/**
	 * Reuse Et2Template error visuals for consistency with the rest of eTemplate.
	 */
	private _et2ErrorTemplate(errorMessage : string) : TemplateResult
	{
		return Et2Template.prototype.errorTemplate.call(this as unknown as Et2Template, errorMessage);
	}


	/**
	 * Convenience accessor for table body element.
	 */
	private get _rowsBody() : HTMLElement | null
	{
		return this.shadowRoot?.getElementById("rows") ?? null;
	}

	/**
	 * Convenience accessor for scroll container.
	 */
	private get _body() : HTMLElement | null
	{
		return this.shadowRoot?.querySelector(".dg-body") as HTMLElement | null;
	}

	private get _spacerBlock() : HTMLElement | null
	{
		return this.shadowRoot?.querySelector(".dg-row-spacer") as HTMLElement | null;
	}

	/**
	 * Bind event handlers once so add/remove listeners and template callbacks keep stable references.
	 */
	constructor()
	{
		super();
		this._onTableClick = this._onTableClick.bind(this);
		this._onTableKeydown = this._onTableKeydown.bind(this);
		this._scrollListener = () => this._maybePrefetchOnScroll();
	}

	/**
	 * Disconnect observer resources when component is detached.
	 */
	disconnectedCallback()
	{
		this.observer?.disconnect();
		if(this._body && this._scrollListener)
		{
			this._body.removeEventListener("scroll", this._scrollListener);
		}
		super.disconnectedCallback();
	}

	/**
	 * Start lazy-loading observer after first paint.
	 */
	firstUpdated(changedProperties : PropertyValues)
	{
		super.firstUpdated(changedProperties);
		this._rowHeightPx = this._resolveTemplateRowHeightPx() ?? this._defaultRowHeightPx();
		this._initObserver();
		this._observeSentinel();
		if(this._body && this._scrollListener)
		{
			this._body.addEventListener("scroll", this._scrollListener, {passive: true});
		}
	}

	/**
	 * Re-render physical row DOM when structure-defining inputs change.
	 * We rebuild rows here because template/column changes alter generated markup.
	 */
	updated(changedProperties : PropertyValues)
	{
		super.updated(changedProperties);
		if(changedProperties.has("templateData"))
		{
			if(!this._rowHeightLocked)
			{
				this._rowHeightPx = this._resolveTemplateRowHeightPx() ?? this._rowHeightPx ?? this._defaultRowHeightPx();
			}
			this._renderRowsIntoContainer(true);
			this._ensureTableColSizes();
		}
		if(changedProperties.has("columns"))
		{
			this._renderRowsIntoContainer(true);
			this._ensureTableColSizes();
		}
		this._observeSentinel();
	}

	/**
	 * Seed datagrid with preloaded rows and skip initial fetch.
	 */
	public setInitialRows(rows : any[])
	{
		const mappedRows = (rows || []).map((row, index) => ({
			id: this._rowIdFor(row, index),
			data: row
		}));
		this._clearRows();
		this.rows = mappedRows;
		this.loading = false;
		this.fetching = false;
		this.displayedRowIds = new Set(mappedRows.map((row) => row.id));
		this._renderRowsIntoContainer(true);
	}

	/**
	 * Reset all grid runtime state including selection and fetch markers.
	 */
	public clear()
	{
		this._clearRows();
		this.total = null;
		this.loading = false;
		this.fetching = false;
		this.fetchFailed = false;
		this.fetchErrorMessage = "";
		this._hasFetchedOnce = false;
		this._pendingPlaceholderCount = 0;
		this._rowHeightLocked = false;
		this._rowHeightPx = this._resolveTemplateRowHeightPx() ?? this._defaultRowHeightPx();
		this.selectedRowIds.clear();
		this.anchorRowIndex = -1;
		this.activeRowIndex = -1;
		this.activeRowId = null;
	}

	/**
	 * Clear current rows and load from first page.
	 */
	public async reload() : Promise<void>
	{
		this._clearRows();
		this.total = null;
		this.fetchFailed = false;
		this.fetchErrorMessage = "";
		this._hasFetchedOnce = false;
		this._pendingPlaceholderCount = 0;
		await this.loadMore();
	}

	/**
	 * Trigger next page load when allowed by current state.
	 */
	public loadMore()
	{
		if(this.fetching || !this.dataProvider || this.fetchFailed)
		{
			return;
		}
		const loadedCount = this.displayedRowIds.size;
		const pendingCount = this._pendingPlaceholderCount;
		if(this.total !== null && loadedCount + pendingCount >= this.total)
		{
			return;
		}

		const requestedCount = this.total !== null
			? Math.max(0, Math.min(this.pageSize, this.total - loadedCount - pendingCount))
			: this.pageSize;
		if(requestedCount <= 0)
		{
			return;
		}

		// Insert placeholders before the network request so users see imminent row reservation immediately.
		this._pendingPlaceholderCount += requestedCount;
		this._renderRowsIntoContainer();

		window.setTimeout(() =>
		{
			this._fetchPage(loadedCount, requestedCount);
		});
	}

	/**
	 * Observe bottom sentinel to drive infinite scroll.
	 */
	private _initObserver()
	{
		if(typeof IntersectionObserver === "undefined")
		{
			return;
		}

		const root = this.shadowRoot?.querySelector(".dg-body");
		this.observer = new IntersectionObserver((entries) =>
			{
				for(const entry of entries)
				{
					if(entry.isIntersecting)
					{
						this.loadMore();
					}
				}
			}, {
				root: root as Element,
				// Threshold 0 + positive bottom margin is more reliable for infinite scroll than tiny target ratios.
				threshold: 0,
				rootMargin: "0px 0px 160px 0px"
			});
	}

	/**
	 * Attach observer to current sentinel node.
	 * We call this after updates because template diffs can replace DOM nodes.
	 */
	private _observeSentinel()
	{
		if(!this.observer)
		{
			return;
		}
		const sentinel = this.shadowRoot?.getElementById("sentinel");
		if(!sentinel)
		{
			return;
		}
		this.observer.disconnect();
		this.observer.observe(sentinel);
		if(this._spacerBlock) this.observer.observe(this._spacerBlock);
	}

	/**
	 * Request one page from provider and merge rows preserving uniqueness.
	 */
	private async _fetchPage(start : number, requestedCount : number = 0)
	{
		if(!this.dataProvider)
		{
			return;
		}
		this.fetching = true;
		this.loading = true;
		this.dispatchEvent(new CustomEvent("et2-loading-start", {bubbles: true, composed: true}));

		try
		{
			this._appendLoadingPlaceholders(this._rowsBody);
			const response = await this.dataProvider.fetchPage(start, this.pageSize);
			this.fetching = false;
			this.loading = false;
			this.fetchFailed = false;
			this.fetchErrorMessage = "";
			this._hasFetchedOnce = true;
			if(requestedCount > 0)
			{
				this._pendingPlaceholderCount = Math.max(0, this._pendingPlaceholderCount - requestedCount);
			}
			if(typeof response.total !== "undefined")
			{
				this.total = response.total ?? null;
			}

			for(const row of response.rows || [])
			{
				if(this.displayedRowIds.has(row.id))
				{
					continue;
				}
				this.displayedRowIds.add(row.id);
				this.rows = [...this.rows, row];
			}

			this._renderRowsIntoContainer();
			this.dispatchEvent(new CustomEvent("et2-loading-done", {bubbles: true, composed: true}));
		}
			catch(e)
			{
				this.fetching = false;
				this.loading = false;
				this.fetchFailed = true;
				this._hasFetchedOnce = true;
				this._pendingPlaceholderCount = 0;
				// Store message so state template can surface meaningful diagnostics.
				this.fetchErrorMessage = e?.message || "";
				this._renderRowsIntoContainer();
				this.dispatchEvent(new CustomEvent("et2-loading-error", {bubbles: true, composed: true}));
			}
		}

	/**
	 * Clear rendered rows and related in-memory row id tracking.
	 */
	private _clearRows()
	{
		this.rows = [];
		this.displayedRowIds.clear();
		this._pendingPlaceholderCount = 0;
		if(this._rowsBody)
		{
			this._rowsBody.innerHTML = "";
		}
	}

	/**
	 * Reconcile logical rows to physical DOM rows.
	 * We manually patch tbody for predictable performance with large/incremental loads.
	 */
	private _renderRowsIntoContainer(force : boolean = false)
	{
		const container = this._rowsBody;
		if(!container)
		{
			return;
		}
		if(force)
		{
			container.innerHTML = "";
		}
		else
		{
			container.querySelectorAll("tr[data-et2dg-placeholder='1'], tr[data-et2dg-spacer='1']").forEach((row) => row.remove());
		}

		const existingIds = new Set(Array.from(container.querySelectorAll("tr[data-rowid]"))
			.map((row) => row.getAttribute("data-rowid")));
		for(let index = 0; index < this.rows.length; index++)
		{
			const row = this.rows[index];
			if(!force && existingIds.has(row.id))
			{
				continue;
			}
			const rowElement = this._buildRowElement(row, index);
			if(rowElement)
			{
				container.appendChild(rowElement);
			}
		}

		this._appendVirtualSpacer(container);

		if(this.activeRowIndex < 0 && this.rows.length)
		{
			// Keep keyboard navigation usable as soon as first row appears.
			this.activeRowIndex = 0;
			this.activeRowId = this.rows[0].id;
			this.anchorRowIndex = 0;
		}
		this._syncRowAccessibilityState();
		this._lockRowHeightFromRenderedRows();
		// After layout changes, check if we are already near the end and should prefetch immediately.
		this._maybePrefetchOnScroll();
	}

	/**
	 * Insert placeholder rows reserved for the currently pending page request.
	 */
	private _appendLoadingPlaceholders(container : HTMLElement)
	{
		if(this._pendingPlaceholderCount <= 0)
		{
			return;
		}
		const colCount = Math.max(1, this.columns.filter((column) => !this._isColumnHidden(column)).length);
		const rowHeightPx = this._rowHeightPx ?? this._defaultRowHeightPx();
		for(let i = 0; i < this._pendingPlaceholderCount; i++)
		{
			const tr = document.createElement("tr");
			tr.setAttribute("data-et2dg-placeholder", "1");
			tr.classList.add("dg-row-placeholder");
			tr.setAttribute("aria-hidden", "true");

			const td = document.createElement("td");
			td.classList.add("dg-placeholder-cell");
			td.innerHTML = `<sl-skeleton effect="sheen" style="width:100%"></sl-skeleton>`;
			tr.appendChild(td);
			container.insertBefore(tr, container.querySelector(".dg-row-spacer"));
		}
	}

	/**
	 * Add one spacer row so the scrollbar reflects total rows without rendering all unloaded rows.
	 */
	private _appendVirtualSpacer(container : HTMLElement)
	{
		let spacerHeight = 0;
		if(this.total === null)
		{
			if(this._spacerBlock) this._spacerBlock.style.height = "0px";
			return;
		}
		const remainingRows = Math.max(0, this.total - this.rows.length - this._pendingPlaceholderCount);
		if(remainingRows <= 0)
		{
			if(this._spacerBlock) this._spacerBlock.style.height = "0px";
			return;
		}
		const rowHeightPx = this._rowHeightPx ?? this._defaultRowHeightPx();
		spacerHeight = Math.max(0, Math.round(remainingRows * rowHeightPx));
		if(spacerHeight <= 0)
		{
			if(this._spacerBlock) this._spacerBlock.style.height = "0px";
			return;
		}

		const spacerBlock=this._spacerBlock ?? document.createElement("div");
		spacerBlock.classList.add("dg-row-spacer");
		spacerBlock.setAttribute("aria-hidden", "true");
		spacerBlock.style.height = `${spacerHeight}px`;
		container.appendChild(spacerBlock);
	}

	/**
	 * Determine initial row height from template hints (`height`, `min-height`, inline style).
	 */
	private _resolveTemplateRowHeightPx() : number | null
	{
		const template = this.templateData?.rowTemplate;
		const row = template?.content?.firstElementChild as HTMLElement | null;
		const candidate =
			row?.style?.height ||
			row?.style?.minHeight ||
			row?.getAttribute?.("height") ||
			row?.getAttribute?.("data-row-height") ||
			null;
		if(!candidate)
		{
			return null;
		}
		return this._lengthToPx(candidate);
	}

	/**
	 * Lock row height after first rows are rendered by averaging visible row heights.
	 */
	private _lockRowHeightFromRenderedRows()
	{
		if(this._rowHeightLocked || this.rows.length === 0)
		{
			return;
		}
		requestAnimationFrame(() =>
		{
			if(this._rowHeightLocked)
			{
				return;
			}
			const rows = Array.from(this._rowsBody?.querySelectorAll("tr[data-rowid]") || []) as HTMLElement[];
			if(!rows.length)
			{
				return;
			}
			const heights = rows
				.slice(0, Math.min(12, rows.length))
				.map((row) => row.getBoundingClientRect().height)
				.filter((height) => height > 0);
			if(!heights.length)
			{
				return;
			}
			const avg = heights.reduce((sum, height) => sum + height, 0) / heights.length;
			this._rowHeightPx = Math.max(1, avg);
			this._rowHeightLocked = true;
			// Re-render once so virtual spacer reflects measured height.
			this._renderRowsIntoContainer();
		});
	}

	/**
	 * Convert simple CSS lengths to pixels for row-height calculation.
	 */
	private _lengthToPx(length : string) : number | null
	{
		const value = String(length || "").trim().toLowerCase();
		if(!value)
		{
			return null;
		}
		if(/^\d+(\.\d+)?$/.test(value))
		{
			return parseFloat(value);
		}
		if(value.endsWith("px"))
		{
			return parseFloat(value);
		}
		if(value.endsWith("rem"))
		{
			return parseFloat(value) * parseFloat(getComputedStyle(document.documentElement).fontSize || "16");
		}
		if(value.endsWith("em"))
		{
			const base = parseFloat(getComputedStyle(this).fontSize || "16");
			return parseFloat(value) * base;
		}
		return null;
	}

	/**
	 * Default fallback row height used until template hints or real measurements are available.
	 */
	private _defaultRowHeightPx() : number
	{
		const base = parseFloat(getComputedStyle(this).fontSize || "16");
		return base * 3;
	}

	/**
	 * Prefetch when user is close to the end so additional rows appear without a visible wait at bottom.
	 */
	private _maybePrefetchOnScroll()
	{
		if(this.fetching || this._pendingPlaceholderCount > 0)
		{
			return;
		}
		const body = this._body;
		if(!body)
		{
			return;
		}
		const rowHeightPx = this._rowHeightPx ?? this._defaultRowHeightPx();
		const preloadDistance = Math.max(rowHeightPx * 8, 240);
		const remaining = body.scrollHeight - body.scrollTop - body.clientHeight;
		if(remaining <= preloadDistance)
		{
			this.loadMore();
		}
	}

	/**
	 * Build one row element from prepared template data or fallback plain cells.
	 */
	private _buildRowElement(row : Et2DatagridRow, rowIndex : number) : HTMLElement | null
	{
		const template = this.templateData?.rowTemplate;
		const templateXml = this.templateData?.rowTemplateXml;
		if(!template && !templateXml)
		{
			const tr = document.createElement("tr");
			tr.innerHTML = this.columns
				.filter((column) => !this._isColumnHidden(column))
				.map((column) => `<td>${String(this._getFieldValue(row.data, column.key) ?? "")}</td>`)
				.join("");
			this._markRowElement(tr, row, rowIndex);
			return tr;
		}

		let fragment : DocumentFragment | null = null;
		if(template)
		{
			fragment = document.importNode(template.content, true);
		}
		else if(templateXml)
		{
			const templateNode = document.createElement("template");
			templateNode.content.appendChild(templateXml.cloneNode(true));
			fragment = templateNode.content.cloneNode(true) as DocumentFragment;
		}
		if(!fragment)
		{
			return null;
		}

		this._populateCloneWithRow(fragment, row.data);
		const root = (fragment.firstElementChild || null) as HTMLElement | null;
		if(!root)
		{
			return null;
		}
		root.classList.add("loading");
		this._markRowElement(root, row, rowIndex);
		this._upgradeRowElements(root, row.data, rowIndex);
		return root;
	}

	/**
	 * Stamp row-level accessibility and identity attributes.
	 */
	private _markRowElement(rowElement : HTMLElement, row : Et2DatagridRow, rowIndex : number)
	{
		rowElement.setAttribute("role", "row");
		rowElement.setAttribute("data-rowid", row.id);
		rowElement.setAttribute("aria-rowindex", String(rowIndex + 1));
		rowElement.setAttribute("aria-selected", this.selectedRowIds.has(row.id) ? "true" : "false");
		rowElement.tabIndex = rowIndex === this.activeRowIndex ? 0 : -1;
	}

	/**
	 * Replace simple row placeholders in text nodes.
	 */
	private _populateCloneWithRow(fragment : DocumentFragment, row : any)
	{
		const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT, null);
		const texts : Text[] = [];
		let node : Node | null = null;
		while((node = walker.nextNode()) !== null)
		{
			texts.push(node as Text);
		}
		for(const text of texts.filter(t => t.nodeValue.trim()))
		{
			let value = text.nodeValue || "";
			if(!value) continue;
			value = value.replace(/\{([^}]+)\}/g, (_match, token) => String(this._getFieldValue(row, token) ?? ""));
			value = value.replace(/\$row\.([a-zA-Z0-9_.]+)/g, (_match, token) => String(this._getFieldValue(row, token) ?? ""));
			text.nodeValue = value;
		}
	}

	/**
	 * Upgrade and configure custom child widgets after row insertion.
	 * This is deferred to keep scrolling/rendering responsive.
	 */
	private _upgradeRowElements(rowRoot : HTMLElement, rowData : any, rowIndex : number)
	{
		const toUpgrade = Array.from(rowRoot.querySelectorAll("*")) as any[];
		if(!toUpgrade.length)
		{
			return;
		}

		const mgrRowData = {};
		mgrRowData[rowIndex] = rowData;
		const mgr = this.getArrayMgr("content")?.openPerspective(this, mgrRowData, rowIndex);
		// Use async boundary so DOM append completes before custom element upgrades run.
		setTimeout(() =>
		{
			try
			{
				const ce = (window as any).customElements;
				if(ce && typeof ce.upgrade === "function")
				{
					for(const element of toUpgrade)
					{
						try { ce.upgrade(element); } catch(e) {}
					}
				}

				for(const element of toUpgrade)
				{
					try
					{
						const id = element.getAttribute?.("data-et2nm-id");
						const stored = id ? this.templateData?.rowTemplateAttrMap?.[id] : null;
						if(element.setArrayMgr && mgr)
						{
							element.setArrayMgr("content", mgr);
						}
						if(typeof element.transformAttributes === "function")
						{
							if(stored)
							{
								element.transformAttributes(stored);
							}
							else
							{
								const attrs : Record<string, string> = {};
								for(let i = 0; i < element.attributes.length; i++)
								{
									attrs[element.attributes[i].name] = element.attributes[i].value;
								}
								element.transformAttributes(attrs);
							}
						}
					}
					catch(e)
					{
					}
				}
			}
			catch(e)
			{
			}
			rowRoot.classList.remove("loading");
		}, 0);
	}

	/**
	 * Resolve stable row id from common fields with fallback index.
	 */
	private _rowIdFor(row : any, fallbackIndex : number) : string
	{
		return String(row?.uid ?? row?.id ?? row?.row_id ?? fallbackIndex);
	}

	/**
	 * Resolve a field value, including dot-path lookup.
	 */
	private _getFieldValue(row : any, key : string)
	{
		if(!row || !key)
		{
			return "";
		}
		if(key.indexOf(".") > -1)
		{
			return key.split(".").reduce((acc, part) => acc && typeof acc[part] !== "undefined" ? acc[part] : "", row);
		}
		return typeof row[key] !== "undefined" ? row[key] : "";
	}

	/**
	 * Evaluate whether a column should be hidden (supports boolean and expression strings).
	 */
	private _isColumnHidden(column : Et2DatagridColumn) : boolean
	{
		if(!column)
		{
			return false;
		}
		const disabled = column.disabled;
		if(typeof disabled === "boolean")
		{
			return disabled;
		}
		if(typeof disabled === "undefined" || disabled === null)
		{
			return false;
		}
		const expression = String(disabled).trim();
		if(expression === "")
		{
			return false;
		}
		try
		{
			const mgr = this.getArrayMgr && this.getArrayMgr("content");
			if(mgr && typeof mgr.parseBoolExpression === "function")
			{
				return !!mgr.parseBoolExpression(expression);
			}
		}
		catch(e)
		{
		}
		const normalized = expression.toLowerCase();
		return normalized === "true" || normalized === "1";
	}

	/**
	 * Build inline style string for width/min-width constraints.
	 */
	private _colStyle(column : Et2DatagridColumn) : string
	{
		const styles : string[] = [];
		if(column.width)
		{
			let width = String(column.width);
			if(/^\d+$/.test(width))
			{
				width += "px";
			}
			styles.push("flex-basis: " + width);
			styles.push("width: " + width);
		}
		if(column.minWidth)
		{
			let minWidth = String(column.minWidth);
			if(/^\d+$/.test(minWidth))
			{
				minWidth += "px";
			}
			styles.push("min-width: " + minWidth);
		}
		return styles.join("; ");
	}

	private _columnWidths(columns : Et2DatagridColumn[]) : string
	{
		let columnsWidths = [];
		const leftovers = !columns.find(column => column.width.endsWith("%") || !column.width);
		columns.forEach(column => {
			if(column.width)
			{
				let width = String(column.width);
				if(/^\d+$/.test(width))
				{
					width += "px";
					return columnsWidths.push(leftovers ? `minmax(${width}, 1fr)` : width);
				}
				return columnsWidths.push(`minmax(${width}, 1fr)`);
			}
		});

		return columnsWidths.join(" ");
	}

	/**
	 * Keep table columns aligned with currently visible columns.
	 */
	private _ensureTableColSizes()
	{
		const visibleColumns = this.columns.filter((column) => !this._isColumnHidden(column));
		this._body.style['--column-sizes'] = this._columnWidths(visibleColumns);
	}

	/**
	 * Handle pointer row activation + selection.
	 */
	private _onTableClick(event : MouseEvent)
	{
		const target = event.target as HTMLElement | null;
		const row = target?.closest("tr[data-rowid]") as HTMLElement | null;
		if(!row)
		{
			return;
		}
		const rowId = row.getAttribute("data-rowid") || "";
		const rowIndex = this.rows.findIndex((r) => r.id === rowId);
		if(rowIndex < 0)
		{
			return;
		}
		this._moveActiveRow(rowIndex, true);
		this._updateSelectionFromPointer(rowId, rowIndex, event);
	}

	/**
	 * Handle keyboard navigation and selection interactions.
	 */
	private _onTableKeydown(event : KeyboardEvent)
	{
		const key = event.key;
		if(!["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "a", "A"].includes(key))
		{
			return;
		}
		if(!this.rows.length)
		{
			return;
		}

		const pageStep = Math.max(1, Math.floor((this._body?.clientHeight || 0) / 44));
		let nextIndex = this.activeRowIndex >= 0 ? this.activeRowIndex : 0;
		if(key === "ArrowUp") nextIndex = Math.max(0, nextIndex - 1);
		if(key === "ArrowDown") nextIndex = Math.min(this.rows.length - 1, nextIndex + 1);
		if(key === "PageUp") nextIndex = Math.max(0, nextIndex - pageStep);
		if(key === "PageDown") nextIndex = Math.min(this.rows.length - 1, nextIndex + pageStep);
		if(key === "Home") nextIndex = 0;
		if(key === "End") nextIndex = this.rows.length - 1;

		if(key === " " || key === "Spacebar")
		{
			event.preventDefault();
			this._toggleSelectionOnActiveRow();
			return;
		}
		if((key === "a" || key === "A") && (event.ctrlKey || event.metaKey))
		{
			if(this.selectionMode === "multiple")
			{
				event.preventDefault();
				this.selectedRowIds = new Set(this.rows.map((row) => row.id));
				this._syncRowAccessibilityState();
				this._emitSelectionChanged();
			}
			return;
		}

		event.preventDefault();
		const previous = this.activeRowIndex;
		this._moveActiveRow(nextIndex, true);
		if(event.shiftKey && this.selectionMode === "multiple")
		{
			this._selectRange(this.anchorRowIndex >= 0 ? this.anchorRowIndex : previous, nextIndex);
		}
	}

	protected _handleColumnSelectionClick(event : MouseEvent) : void
	{

	}

	/**
	 * Toggle selected state for active row according to current selection mode.
	 */
	private _toggleSelectionOnActiveRow()
	{
		if(this.selectionMode === "none" || this.activeRowIndex < 0)
		{
			return;
		}
		const row = this.rows[this.activeRowIndex];
		if(!row)
		{
			return;
		}

		if(this.selectionMode === "single")
		{
			this.selectedRowIds = new Set([row.id]);
		}
		else
		{
			const next = new Set(this.selectedRowIds);
			if(next.has(row.id))
			{
				next.delete(row.id);
			}
			else
			{
				next.add(row.id);
			}
			this.selectedRowIds = next;
		}
		this._syncRowAccessibilityState();
		this._emitSelectionChanged();
	}

	/**
	 * Update selection model from pointer gesture semantics.
	 */
	private _updateSelectionFromPointer(rowId : string, rowIndex : number, event : MouseEvent)
	{
		if(this.selectionMode === "none")
		{
			return;
		}
		if(this.selectionMode === "single")
		{
			this.selectedRowIds = new Set([rowId]);
			this.anchorRowIndex = rowIndex;
			this._syncRowAccessibilityState();
			this._emitSelectionChanged();
			return;
		}

		if(event.shiftKey && this.anchorRowIndex >= 0)
		{
			this._selectRange(this.anchorRowIndex, rowIndex);
			return;
		}

		const toggle = event.ctrlKey || event.metaKey;
		if(toggle)
		{
			const next = new Set(this.selectedRowIds);
			if(next.has(rowId))
			{
				next.delete(rowId);
			}
			else
			{
				next.add(rowId);
			}
			this.selectedRowIds = next;
		}
		else
		{
			this.selectedRowIds = new Set([rowId]);
		}

		this.anchorRowIndex = rowIndex;
		this._syncRowAccessibilityState();
		this._emitSelectionChanged();
	}

	/**
	 * Select inclusive row range, used for shift-selection.
	 */
	private _selectRange(startIndex : number, endIndex : number)
	{
		if(this.selectionMode !== "multiple")
		{
			return;
		}
		const start = Math.min(startIndex, endIndex);
		const end = Math.max(startIndex, endIndex);
		const next = new Set<string>();
		for(let i = start; i <= end; i++)
		{
			if(this.rows[i])
			{
				next.add(this.rows[i].id);
			}
		}
		this.selectedRowIds = next;
		this._syncRowAccessibilityState();
		this._emitSelectionChanged();
	}

	/**
	 * Move active row and optionally focus corresponding DOM row.
	 */
	private _moveActiveRow(index : number, focus : boolean)
	{
		if(index < 0 || index >= this.rows.length)
		{
			return;
		}
		this.activeRowIndex = index;
		this.activeRowId = this.rows[index].id;
		if(this.anchorRowIndex < 0)
		{
			this.anchorRowIndex = index;
		}
		this._syncRowAccessibilityState();

		if(focus)
		{
			const rowElement = (Array.from(this._rowsBody?.querySelectorAll("tr[data-rowid]") || []) as HTMLElement[])
				.find((row) => row.getAttribute("data-rowid") === this.rows[index].id) || null;
			rowElement?.focus();
			rowElement?.scrollIntoView({block: "nearest"});
		}
	}

	/**
	 * Synchronize ARIA attributes and tabindex across rendered row DOM.
	 */
	private _syncRowAccessibilityState()
	{
		const rowElements = Array.from(this._rowsBody?.querySelectorAll("tr[data-rowid]") || []) as HTMLElement[];
		rowElements.forEach((rowElement, rowIndex) =>
		{
			const rowId = rowElement.getAttribute("data-rowid") || "";
			rowElement.setAttribute("role", "row");
			rowElement.setAttribute("aria-selected", this.selectedRowIds.has(rowId) ? "true" : "false");
			rowElement.setAttribute("aria-rowindex", String(rowIndex + 1));
			rowElement.tabIndex = rowIndex === this.activeRowIndex ? 0 : -1;

			const cells = Array.from(rowElement.children) as HTMLElement[];
			cells.forEach((cell, cellIndex) =>
			{
				const isHeader = cell.tagName.toLowerCase() === "th";
				cell.setAttribute("role", isHeader ? "columnheader" : "gridcell");
				cell.setAttribute("aria-colindex", String(cellIndex + 1));
			});
		});
	}

	/**
	 * Emit normalized selection detail for parent listeners.
	 */
	private _emitSelectionChanged()
	{
		const selectedRows = this.rows.filter((row) => this.selectedRowIds.has(row.id)).map((row) => row.data);
		const detail : Et2DatagridSelectionDetail = {
			selectedRowIds: Array.from(this.selectedRowIds),
			selectedRows,
			activeRowId: this.activeRowId,
			activeRowIndex: this.activeRowIndex
		};
		this.dispatchEvent(new CustomEvent("et2-selection-changed", {
			detail,
			bubbles: true,
			composed: true
		}));
	}

	/**
	 * Extract slot-provided loader template HTML for state rendering fallback.
	 */
	private _loaderHtml() : string
	{
		const loaderTemplate = this.templateData?.loaderTemplate;
		if(!loaderTemplate)
		{
			return "";
		}
		return loaderTemplate.innerHTML || "";
	}


	/**
	 * Resolve high-level visual state (loading, error, missing template, empty).
	 */
	private _stateTemplate() : TemplateResult | null
	{
		const hasTemplate = !!this.templateData?.rowTemplate || this.columns.length > 0;
		const hasRows = this.rows.length > 0 || this._pendingPlaceholderCount > 0 || (this.total !== null && this.total > 0);
		const initialLoading = this.configurationLoading || (this.fetching && !hasRows);
		const noTemplate = this.requireTemplate && !this.configurationLoading && !hasTemplate;
		const fetchFailed = this.fetchFailed;
		const noRows = !hasRows && !this.fetching && !fetchFailed && !noTemplate;

		if(initialLoading)
		{
			return html`
				<div class="dg-state dg-state--loading">
					${this.templateData?.loaderTemplate
			          ? html`${unsafeHTML(this._loaderHtml())}`
			          : this._et2LoadingTemplate()}
				</div>
			`;
		}
		if(fetchFailed)
		{
			const message = this.fetchErrorMessage || this.egw().lang("Unable to load rows. Please try again.");
			return html`<div class="dg-state dg-state--error">${this._et2ErrorTemplate(message)}</div>`;
		}
		if(noTemplate)
		{
			return html`
				<div class="dg-state" part="state">
					<sl-alert variant="primary" open>
						<sl-icon slot="icon" name="layout-text-window-reverse"></sl-icon>
						<strong>${this.egw().lang("No row template configured")}</strong><br/>
						${this.egw().lang("Set a template or provide row/header slots.")}
					</sl-alert>
				</div>
			`;
		}
		if(noRows)
		{
			return html`
				<div class="dg-state" part="state">
					<sl-alert variant="neutral" open>
						<sl-icon slot="icon" name="inbox"></sl-icon>
						<strong>${this.egw().lang("No entries to display")}</strong><br/>
						${this._hasFetchedOnce ? this.egw().lang("No rows were returned.") : this.egw().lang("Waiting for rows.")}
					</sl-alert>
				</div>
			`;
		}
		return null;
	}

	protected _headerTemplate(visibleColumns:Et2DatagridColumn[])
	{
		const columnsHeaders = html`
			${visibleColumns.map((column) => html`
				<div class="dg-col" role="columnheader" title=${column.title}>
					${column.header ?? column.title}
				</div>
			`)}
			${this.noColumnSelection ? nothing : html`
				<div class="dg-colselection">
					<et2-button-icon image="list-task" label=${this.egw().lang("select columns")} @click=${this._handleColumnSelectClick}
									 noSubmit
					></et2-button-icon>
				</div>
			`}
		`;
		return html`
			<div class="dg-header" role="rowgroup">
				${visibleColumns.length > 0 ? columnsHeaders : 	html`<slot name="header"></slot>`}
			</div>
		`;
	}

	/**
	 * A non-visible header for accessibility at the top of the table
	 *
	 * @param {Et2DatagridColumn[]} visibleColumns
	 * @return {TemplateResult<1>}
	 * @private
	 */
	private _accessableHeaderTemplate(visibleColumns:Et2DatagridColumn[])
	{
		return html`${visibleColumns.map((column) => {
			return html`
				<td>
					<div data-id=${column.key}>
						${column.title}
					</div>
				</td>`
		})}`;
	}

	/**
	 * Render datagrid chrome, state messages, and row table.
	 */
	render()
	{
		const visibleColumns = this.columns.filter((column) => !this._isColumnHidden(column));
		const headerTemplate = this._headerTemplate(visibleColumns);
		const stateTemplate = this._stateTemplate();
		const styles = {
			'--column-count' : visibleColumns.length,
			'--column-sizes' : this._columnWidths(visibleColumns),
		}
		return html`
			<div class="dg-root" style=${styleMap(styles)}>
				<!-- Visible header for users -->
				${headerTemplate}

				<div class="dg-body">
					${stateTemplate}

					<table
						role="grid"
						aria-label=${this.getAttribute("aria-label") || this.getAttribute("label") || "Data grid"}
						aria-multiselectable=${String(this.selectionMode === "multiple")}
						aria-colcount=${String(visibleColumns.length || this.columns.length || 1)}
						aria-rowcount=${String(this.total ?? this.rows.length)}
						?hidden=${!!stateTemplate}
						@click=${this._onTableClick}
						@keydown=${this._onTableKeydown}
					>
						<!-- Accessible / sizing header -->
						<thead>
							${this._accessableHeaderTemplate(visibleColumns)}
						</thead>
						<tbody id="rows" role="rowgroup"></tbody>
					</table>
					<div id="sentinel" aria-hidden="true"></div>
				</div>
			</div>
		`;
	}
}
