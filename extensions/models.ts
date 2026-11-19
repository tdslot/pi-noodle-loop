export const modelIdentity = (model: string) => model.replace(/:(off|minimal|low|medium|high|xhigh|max)$/, "");
export function resolveModelIdentity(spec: string, models: readonly { provider: string; id: string }[]): string {
 // Match Pi precedence: literal IDs may themselves end in a thinking-level suffix.
 const exact = models.filter(m => `${m.provider}/${m.id}` === spec || m.id === spec);
 const id = modelIdentity(spec);
 const matches = exact.length ? exact : models.filter(m => `${m.provider}/${m.id}` === id || m.id === id);
 if (matches.length !== 1) throw new Error(`Use an unambiguous available model ID, not a fuzzy alias: ${spec}`);
 return `${matches[0].provider}/${matches[0].id}`;
}

export function nativeModels(routing: Record<string,string>, current: {provider:string;id:string}|undefined, available: readonly {provider:string;id:string}[]|undefined) {
 const impl = routing['noodle-execute'] ?? routing.default ?? (current && `${current.provider}/${current.id}`);
 const review = routing['noodle-review'];
 if(!impl || !review) throw new Error('Native independent review requires routing.noodle-review and an implementation model.');
 if(!available) throw new Error('Native review requires available model registry validation.');
 if(impl==='inherit' || review==='inherit') throw new Error('Native models must be explicit available IDs, not inherit.');
 const implId=resolveModelIdentity(impl,available),reviewId=resolveModelIdentity(review,available);
 if(implId===reviewId) throw new Error('Native reviewer must use a known model different from the implementation model; configure routing.noodle-review.');
 const qualified=(spec:string,id:string)=>id+(available.some(m=>spec===m.id || spec===`${m.provider}/${m.id}`) ? '' : spec.slice(modelIdentity(spec).length));
 return {implModel:qualified(impl,implId),reviewModel:qualified(review,reviewId)};
}

