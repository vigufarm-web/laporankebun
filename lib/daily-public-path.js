export const isPublicDailyRead=(pathname,method='GET')=>method==='GET'&&/^\/api\/daily\/(?:hk-summary|public(?:\/photo\/\d+)?)$/.test(pathname);
