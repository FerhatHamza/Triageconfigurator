export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/', '').replace(/\/$/, '');

  // CORS headers
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Code, X-Doctor-Code'
  };

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers });
  }

  try {
    // Check if DB binding exists
    if (!env.DB) {
      throw new Error('Database binding not found. Please bind DB in Pages settings.');
    }

    const db = env.DB;

    // ─── PUBLIC ENDPOINT ───
    if (path === 'config' && request.method === 'GET') {
      const row = await db.prepare(
        "SELECT json_data FROM configs WHERE status = 'active' LIMIT 1"
      ).first();
      
      if (!row) {
        return new Response(JSON.stringify({ error: 'No active config found' }), { 
          status: 404, 
          headers 
        });
      }
      
      return new Response(row.json_data, { headers });
    }

    // ─── DOCTOR ENDPOINTS ───
    if (path === 'doctor/validate' && request.method === 'POST') {
      const body = await request.json();
      const { code } = body;
      
      const doc = await db.prepare(
        "SELECT id, name FROM doctors WHERE code = ?"
      ).bind(code).first();
      
      return new Response(JSON.stringify({ 
        valid: !!doc,
        name: doc?.name || null 
      }), { headers });
    }

    if (path === 'config/propose' && request.method === 'POST') {
      const doctorCode = request.headers.get('X-Doctor-Code');
      
      if (!doctorCode) {
        return new Response(JSON.stringify({ error: 'Code médecin manquant' }), { 
          status: 401, 
          headers 
        });
      }
      
      const doc = await db.prepare(
        "SELECT id FROM doctors WHERE code = ?"
      ).bind(doctorCode).first();
      
      if (!doc) {
        return new Response(JSON.stringify({ error: 'Code médecin invalide' }), { 
          status: 401, 
          headers 
        });
      }
      
      const body = await request.json();
      const { name, description, json_data } = body;
      
      if (!name || !json_data) {
        return new Response(JSON.stringify({ error: 'Champs obligatoires manquants' }), { 
          status: 400, 
          headers 
        });
      }
      
      const result = await db.prepare(
        "INSERT INTO configs (name, description, json_data, status, doctor_id) VALUES (?, ?, ?, 'proposed', ?)"
      ).bind(name, description || '', JSON.stringify(json_data), doc.id).run();
      
      return new Response(JSON.stringify({ 
        success: true,
        id: result.meta.last_row_id 
      }), { headers });
    }

    // ─── ADMIN ENDPOINTS ───
    async function verifyAdmin() {
      const adminCode = request.headers.get('X-Admin-Code');
      
      if (!adminCode) {
        throw new Error('Code admin manquant');
      }
      
      const row = await db.prepare(
        "SELECT code FROM admin_code WHERE id = 1"
      ).first();
      
      if (!row || adminCode !== row.code) {
        throw new Error('Code admin invalide');
      }
    }

    if (path === 'config/list' && request.method === 'GET') {
      try {
        await verifyAdmin();
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { 
          status: 401, 
          headers 
        });
      }
      
      const configs = await db.prepare(
        `SELECT c.id, c.name, c.description, c.status, c.json_data,
                d.code as doctor_code, d.name as doctor_name
         FROM configs c 
         LEFT JOIN doctors d ON c.doctor_id = d.id
         ORDER BY c.id DESC`
      ).all();
      
      return new Response(JSON.stringify(configs.results), { headers });
    }

    if (path === 'config/activate' && request.method === 'PUT') {
      try {
        await verifyAdmin();
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { 
          status: 401, 
          headers 
        });
      }
      
      const body = await request.json();
      const { id } = body;
      
      if (!id) {
        return new Response(JSON.stringify({ error: 'id manquant' }), { 
          status: 400, 
          headers 
        });
      }
      
      await db.batch([
        db.prepare("UPDATE configs SET status = 'archived' WHERE status = 'active'"),
        db.prepare("UPDATE configs SET status = 'active' WHERE id = ?").bind(id)
      ]);
      
      return new Response(JSON.stringify({ success: true }), { headers });
    }

    // ─── 404 ───
    return new Response(JSON.stringify({ error: 'Endpoint not found' }), { 
      status: 404, 
      headers 
    });

  } catch (error) {
    console.error('Worker error:', error);
    return new Response(JSON.stringify({ 
      error: error.message || 'Internal server error',
      stack: error.stack 
    }), { 
      status: 500, 
      headers 
    });
  }
}