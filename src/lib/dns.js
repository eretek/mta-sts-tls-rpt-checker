/*! Eretek — DNS-over-HTTPS istemcisi. Yalnız sabit, denetlenmiş kamusal çözümleyicilere (Cloudflare, Google) JSON API ile gider.
 * Kullanıcı yalnız sorgu adını ve kayıt türünü belirler; çözümleyici URL'si, port veya sunucu seçemez. Referer ve çerez gönderilmez.
 * Sonuç durumları: ok | nxdomain | nodata | servfail | refused | timeout | ratelimit | neterr */
(function (root) {
	'use strict';
	var ERT = root.ERT = root.ERT || {};
	var RESOLVERS = {
		cloudflare: { label: 'Cloudflare 1.1.1.1', url: 'https://cloudflare-dns.com/dns-query' },
		google: { label: 'Google Public DNS 8.8.8.8', url: 'https://dns.google/resolve' }
	};
	var TYPES = { A: 1, NS: 2, CNAME: 5, SOA: 6, MX: 15, TXT: 16, AAAA: 28, SRV: 33, CAA: 257 };
	var NAMES = {}; Object.keys(TYPES).forEach(function (k) { NAMES[TYPES[k]] = k; });

	/** Alan adını doğrular ve IDN'yi punycode'a çevirir; geçersizse null. */
	function normName(s) {
		s = String(s || '').trim().replace(/\.$/, '');
		if (!s || s.length > 253 || /[\s\/\\:@?#]/.test(s)) { return null; }
		var h = s;
		if (/[^\x00-\x7f]/.test(s)) { try { h = new URL('http://' + s).hostname; } catch (e) { return null; } }
		h = h.toLowerCase();
		var labels = h.split('.');
		if (labels.length < 2) { return null; }
		for (var i = 0; i < labels.length; i++) { if (!/^(?!-)[a-z0-9_-]{1,63}(?<!-)$/.test(labels[i])) { return null; } }
		if (/^\d+$/.test(labels[labels.length - 1])) { return null; } // IP adresi değil
		return h;
	}
	/** TXT verisindeki "..." "..." parçalarını aynı kayıt içinde birleştirir. */
	function txtJoin(d) {
		d = String(d);
		if (d[0] !== '"') { return d; }
		var out = '', m, re = /"((?:[^"\\]|\\.)*)"/g;
		while ((m = re.exec(d))) { out += m[1].replace(/\\(\d{3})/g, function (x, n) { return String.fromCharCode(+n); }).replace(/\\(.)/g, '$1'); }
		return out;
	}
	function mapStatus(j) {
		var st = j.Status;
		if (st === 3) { return 'nxdomain'; }
		if (st === 2) { return 'servfail'; }
		if (st === 5) { return 'refused'; }
		if (st !== 0) { return 'servfail'; }
		return 'ok';
	}
	/** Tek sorgu → {status, name, type, answers:[{name,type,TTL,data}], chain:[cname], resolver} */
	function query(name, type, resolverKey) {
		var r = RESOLVERS[resolverKey || 'cloudflare'], qt = TYPES[type];
		if (!r || !qt) { return Promise.reject(new Error('bad resolver/type')); }
		var fx = ERT.dns._fixture;
		if (fx) {
			var k = (resolverKey && resolverKey !== 'cloudflare' ? resolverKey + ':' : '') + name + '|' + type, e = resolverKey && resolverKey !== 'cloudflare' ? fx[k] : fx[name + '|' + type];
			var res0 = e ? JSON.parse(JSON.stringify(e)) : { status: 'nxdomain', answers: [] };
			res0.name = name; res0.type = type; res0.resolver = r.label; res0.answers = res0.answers || []; res0.answers.forEach(function (x) { x.name = x.name || name; x.data = String(x.data); });
			res0.chain = type === 'CNAME' ? [] : res0.answers.filter(function (a) { return a.type === 'CNAME'; }).map(function (a) { return String(a.data).replace(/\.$/, ''); });
			res0.answers = res0.answers.filter(function (a) { return a.type === type || type === 'CNAME'; });
			if (res0.status === 'ok' && !res0.answers.length) { res0.status = 'nodata'; }
			return Promise.resolve(res0);
		}
		var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null, t = setTimeout(function () { if (ctl) { ctl.abort(); } }, 8000);
		var url = r.url + '?name=' + encodeURIComponent(name) + '&type=' + qt;
		return fetch(url, { headers: { accept: 'application/dns-json' }, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', mode: 'cors', signal: ctl ? ctl.signal : undefined })
			.then(function (resp) {
				clearTimeout(t);
				if (resp.status === 429) { return { status: 'ratelimit', answers: [] }; }
				if (!resp.ok) { return { status: 'servfail', answers: [] }; }
				return resp.json().then(function (j) {
					var all = (j.Answer || []).map(function (a) { return { name: String(a.name).replace(/\.$/, ''), type: NAMES[a.type] || String(a.type), TTL: a.TTL, data: a.data }; });
					var ans = all.filter(function (a) { return a.type === type; });
					var st = mapStatus(j);
					if (st === 'ok' && !ans.length) { st = 'nodata'; }
					return { status: st, answers: ans, chain: all.filter(function (a) { return a.type === 'CNAME' && type !== 'CNAME'; }).map(function (a) { return a.data.replace(/\.$/, ''); }), ad: !!j.AD };
				});
			}, function (err) { clearTimeout(t); return { status: err && err.name === 'AbortError' ? 'timeout' : 'neterr', answers: [] }; })
			.then(function (res) { res.name = name; res.type = type; res.resolver = r.label; res.chain = res.chain || []; return res; });
	}
	function txt(name, resolverKey) {
		return query(name, 'TXT', resolverKey).then(function (r) { r.texts = r.answers.map(function (a) { return txtJoin(a.data); }); return r; });
	}
	ERT.dns = { RESOLVERS: RESOLVERS, TYPES: TYPES, normName: normName, query: query, txt: txt, txtJoin: txtJoin, _fixture: null };
}(typeof window !== 'undefined' ? window : globalThis));
