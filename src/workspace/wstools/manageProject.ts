import http from "node:http";

export type CreateProjectOptions = {
  name: string;
  apiPort?: number;
  apiHost?: string;
};


export type RemoveProjectOptions = {
    name: string;
    apiPort?: number;
    apiHost?: string;
};
  

// RECOMMENDED: Use HTTP just like createInstance
export async function createProject(options: CreateProjectOptions): Promise<string> {
  const port = options.apiPort || (process.env.API_PORT ? Number(process.env.API_PORT) : undefined);
  const host = options.apiHost || "localhost";
  
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ name: options.name });
    
    const req = http.request({
      hostname: host,
      port: port,
      path: "/api/projects", // You will need to ensure this endpoint exists in filesystemAPI.ts
      method: "POST",
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          // Parse response { id: "..." }
          const json = JSON.parse(data);
          if (res.statusCode === 200 || res.statusCode === 201) {
            resolve(json.id);
          } else {
            reject(new Error(json.error || `Failed to create project: ${res.statusCode}`));
          }
        } catch (e) {
          reject(new Error("Failed to parse response"));
        }
      });
    });

    req.on("error", (err) => reject(err));
    req.write(payload);
    req.end();
  });
}

async function fetchProjects(host: string, port: number): Promise<any[]> {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: host,
            port: port,
            path: "/api/projects",
            method: "GET",
        }, (res) => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => {
                try {
                    if (res.statusCode === 200) {
                        const json = JSON.parse(data);
                        resolve(json.projects || []);
                    } else {
                        reject(new Error(`Failed to list projects: ${res.statusCode}`));
                    }
                } catch (e) {
                    reject(e);
                }
            });
        });
        req.on("error", reject);
        req.end();
    });
}

export async function removeProject(options: RemoveProjectOptions): Promise<boolean> {
    const port = options.apiPort || (process.env.API_PORT ? Number(process.env.API_PORT) : undefined);
    const host = options.apiHost || "localhost";
    
    if (!port) {
        throw new Error("No API port provided for removeProject");
    }

    // Resolve project ID by name first
    let projectId: string;
    try {
        const projects = await fetchProjects(host, port);
        const project = projects.find((p: any) => p.name === options.name);
        
        if (!project) {
            throw new Error(`Project "${options.name}" not found`);
        }
        projectId = project.id;
    } catch (err) {
        throw err;
    }

    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: host,
        port: port,
        path: `/api/projects/${projectId}`,
        method: "DELETE",
        headers: {
            'Content-Type': 'application/json'
        }
      }, (res) => {
        let data = "";
        res.on("data", chunk => data += chunk);
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode === 200) {
              resolve(true);
            } else if (res.statusCode === 404) {
               // Project not found is usually considered "already deleted" in idempotency terms,
               // but typically a delete action might want to know if it failed.
               // Based on API: returns 404 if not found.
               reject(new Error(json.error || `Project not found`));
            } else {
              reject(new Error(json.error || `Failed to delete project: ${res.statusCode}`));
            }
          } catch (e) {
            reject(new Error("Failed to parse response"));
          }
        });
      });
  
      req.on("error", (err) => reject(err));
      req.end();
    });
  }