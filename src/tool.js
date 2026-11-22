/*! Eretek Online Araçlar #27 — MTA-STS ve TLS-RPT DNS Kontrolü */
ERT.def('27', {
	run: function (v, c) {
		var D = ERT.dns, d = D.normName(v.domain);
		if (!d) { throw c.fe('domain', 'badDomain'); }
		return Promise.all([D.txt('_mta-sts.' + d), D.txt('_smtp._tls.' + d), D.query(d, 'MX')]).then(function (r) {
			var msgs = [], kv = [], vv = {};
			var sts = (r[0].texts || []).filter(function (t) { return /^v=STSv1/i.test(t); }), rpt = (r[1].texts || []).filter(function (t) { return /^v=TLSRPTv1/i.test(t); });
			kv.push(['_mta-sts.' + d, sts.join(' | ') || c.t('st_' + r[0].status)], ['_smtp._tls.' + d, rpt.join(' | ') || c.t('st_' + r[1].status)]);
			vv.sts = sts.length === 1; vv.rpt = rpt.length === 1;
			if (sts.length > 1) { msgs.push(['err', c.t('multiSts')]); }
			else if (sts.length) { var id = (/\bid=([A-Za-z0-9]{1,32})\s*;?/.exec(sts[0]) || [])[1]; msgs.push(id ? ['ok', c.t('stsOk', { id: id })] : ['err', c.t('noId')]); }
			else { msgs.push(['warn', c.t('noSts')]); }
			if (rpt.length > 1) { msgs.push(['err', c.t('multiRpt')]); } else if (rpt.length) { msgs.push(/rua=(mailto:|https:)/i.test(rpt[0]) ? ['ok', c.t('rptOk')] : ['err', c.t('badRua')]); } else { msgs.push(['warn', c.t('noRpt')]); }
			var mx = r[2].answers.map(function (a) { return String(a.data).split(/\s+/).pop().replace(/\.$/, '').toLowerCase(); });
			kv.push(['MX', mx.join(', ') || c.t('st_' + r[2].status)]);
			var pol = String(v.policy || '').trim();
			if (!pol) { msgs.push(['info', c.t('noPolicy', { u: 'https://mta-sts.' + d + '/.well-known/mta-sts.txt' })]); vv.policy = 'unverified'; }
			else {
				var P = { mx: [] };
				pol.replace(/\r/g, '').split('\n').forEach(function (l) { var k = l.indexOf(':'); if (k > 0) { var key = l.slice(0, k).trim().toLowerCase(), val = l.slice(k + 1).trim(); if (key === 'mx') { P.mx.push(val.toLowerCase()); } else { P[key] = val; } } });
				if (P.version !== 'STSv1') { msgs.push(['err', c.t('pVer')]); }
				if (['enforce', 'testing', 'none'].indexOf(P.mode) === -1) { msgs.push(['err', c.t('pMode')]); } else { msgs.push([P.mode === 'enforce' ? 'ok' : 'info', c.t('mode_' + P.mode)]); }
				if (!/^\d+$/.test(P.max_age || '') || +P.max_age > 31557600) { msgs.push(['err', c.t('pAge')]); }
				var miss = mx.filter(function (h) { return !P.mx.some(function (p) { return p === h || (p.indexOf('*.') === 0 && h.slice(-p.length + 1) === p.slice(1) && h.split('.').length === p.split('.').length); }); });
				if (P.mode !== 'none' && miss.length) { msgs.push(['err', c.t('mxMiss', { h: miss.join(', ') })]); } else if (mx.length) { msgs.push(['ok', c.t('mxOk')]); }
				kv.push(['mode', P.mode || '–'], ['max_age', P.max_age || '–'], ['mx (policy)', P.mx.join(', ') || '–']);
				vv.policy = miss.length ? 'mxmiss' : 'ok';
			}
			return { big: c.t('big', { d: d }), kv: kv, msgs: msgs, x: { copy: kv.map(function (x) { return x[0] + ': ' + x[1]; }).join('\n') }, v: vv };
		});
	}
});
