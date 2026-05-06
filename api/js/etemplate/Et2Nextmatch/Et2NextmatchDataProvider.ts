import {Et2DatagridDataProvider, Et2DatagridPageResult, Et2DatagridRow} from "./Et2Datagrid.types";

interface Et2NextmatchProviderHost extends HTMLElement
{
	egw : Function;
	getInstanceManager : Function;
	id : string;
	getAttribute : (name : string) => string | null;
}

/**
 * Nextmatch server adapter for Et2Datagrid.
 * It wraps dataFetch + dataRegisterUID in a generic page provider API.
 */
export class Et2NextmatchDataProvider implements Et2DatagridDataProvider
{
	private host : Et2NextmatchProviderHost;

	/**
	 * @param host Nextmatch owner used to access egw data APIs and exec context.
	 */
	constructor(host : Et2NextmatchProviderHost)
	{
		this.host = host;
	}

	/**
	 * Fetch one page of rows through Nextmatch APIs and return normalized datagrid rows.
	 * We preserve server order by resolving rows into an indexed array before emitting.
	 */
	async fetchPage(start : number, pageSize : number) : Promise<Et2DatagridPageResult>
	{
		const execId = this.host.getInstanceManager?.()?.etemplate_exec_id || "";
		const widgetId = this.host.id || this.host.getAttribute("id") || "";
		const context = {prefix: widgetId || "et2nextmatch"};

		return await new Promise((resolve, reject) =>
		{
			try
			{
				this.host.egw().dataFetch(
					execId,
					{start, num_rows: pageSize},
					{},
					widgetId,
					(resp : any) =>
					{
						if(!resp)
						{
							resolve({rows: [], total: null});
							return;
						}
						const order : string[] = Array.isArray(resp.order) ? resp.order : [];
						if(!order.length)
						{
							resolve({
								rows: [],
								total: typeof resp.total !== "undefined" ? resp.total : null
							});
							return;
						}

							const rowsByIndex : Array<Et2DatagridRow | null> = new Array(order.length).fill(null);
							let pending = order.length;
							order.forEach((uid, index) =>
							{
								// dataRegisterUID can return out-of-order; capture by original position.
								this.host.egw().dataRegisterUID(
								uid,
								(data : any, resolvedUid : string) =>
								{
									rowsByIndex[index] = {
										id: String(resolvedUid || uid),
										data: data || {}
									};
									pending--;
									if(pending <= 0)
									{
										resolve({
											rows: rowsByIndex.filter(Boolean) as Et2DatagridRow[],
											total: typeof resp.total !== "undefined" ? resp.total : null
										});
									}
								},
								this.host,
								execId,
								widgetId
							);
						});
					},
					context,
					null
				);
			}
			catch(e)
			{
				reject(e);
			}
		});
	}
}
