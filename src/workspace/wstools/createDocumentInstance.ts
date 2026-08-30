import http from "node:http";

export type CreateInstanceOptions = {
  name: string;
  projectId: string;
  type: 'document' | 'canvas';
  metadata?: Record<string, any>;
  apiPort?: number;
  apiHost?: string;
};

export type CreateInstanceResponse = {
  id: string;
  error?: string;
};

/**
 * Creates a new instance via the REST API.
 */
export async function createInstance(options: CreateInstanceOptions): Promise<string> {
  const port = options.apiPort || (process.env.API_PORT ? Number(process.env.API_PORT) : undefined);
  const host = options.apiHost || process.env.API_HOST || "localhost";

  return new Promise((resolve, reject) => {
    const { apiPort, apiHost, ...payload } = options;
    const body = JSON.stringify(payload);
    const req = http.request({
      hostname: host,
      port: port,
      path: "/api/instances",
      method: "POST",
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode === 200 || res.statusCode === 201) {
            resolve(json.id);
          } else {
            reject(new Error(json.error || `Failed to create instance: ${res.statusCode}`));
          }
        } catch (e) {
          reject(new Error("Failed to parse creation response"));
        }
      });
    });
    req.on("error", (err) => {
      reject(new Error(`Network error while creating instance: ${err.message}`));
    });
    req.write(body);
    req.end();
  });
}
