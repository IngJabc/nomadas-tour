function slugify(name) {
    return name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/[\s_]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');
}
export async function generateUniqueSubdomain(name, client) {
    const base = slugify(name) || 'agencia';
    for (let i = 0; i < 100; i++) {
        const candidate = i === 0 ? base : `${base}-${i}`;
        const { data } = await client
            .from('agencies')
            .select('id')
            .eq('subdomain', candidate)
            .maybeSingle();
        if (!data)
            return candidate;
    }
    return `${base}-${Date.now()}`;
}
//# sourceMappingURL=subdomain.js.map