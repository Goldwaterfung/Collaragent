export interface MigrationReport {
  success: boolean;
  fromVersion: number;
  toVersion: number;
  migratedAt: string;
  artifactsMigrated: number;
  warnings: string[];
  errors: string[];
}

export interface ValidationResult {
  valid: boolean;
  missingArtifacts: string[];
  corruptedArtifacts: string[];
}

export interface StorageMigration {
  fromVersion: number;
  toVersion: number;
  description: string;
  migrate(workspacePath: string, sourceCagentPath?: string): Promise<MigrationReport>;
  validate(workspacePath: string): Promise<ValidationResult>;
}
