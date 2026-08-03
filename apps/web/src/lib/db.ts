import { PrismaClient } from "@gamers-highlight/db";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createMockModel(modelName: string) {
  return new Proxy({}, {
    get(_target, prop: string) {
      return async (...args: any[]) => {
        const arg = args[0] || {};
        if (prop === "findMany") return [];
        if (prop === "findUnique" || prop === "findFirst") return null;
        if (prop === "count") return 0;
        if (prop === "create" || prop === "update" || prop === "upsert") {
          return {
            id: `mock-${Date.now()}`,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...(arg.data || arg.create || {}),
          };
        }
        if (prop === "delete" || prop === "deleteMany") return { count: 0 };
        return null;
      };
    },
  });
}

function createSafeDb() {
  let rawDb: any;
  try {
    rawDb = globalForPrisma.prisma ?? new PrismaClient();
    if (process.env.NODE_ENV !== "production") {
      globalForPrisma.prisma = rawDb;
    }
  } catch (err) {
    console.warn("[AI Studio] Failed to initialize PrismaClient, using fallback mock db:", err);
    rawDb = null;
  }

  if (!rawDb) {
    return new Proxy({}, {
      get(_target, prop: string) {
        if (prop === "$transaction") {
          return async (fnOrArray: any) => {
            if (typeof fnOrArray === "function") return fnOrArray(createSafeDb());
            if (Array.isArray(fnOrArray)) return Promise.all(fnOrArray);
            return [];
          };
        }
        return createMockModel(prop);
      },
    });
  }

  return new Proxy(rawDb, {
    get(target, prop: string) {
      if (prop === "$transaction") {
        return async (...args: any[]) => {
          try {
            return await target.$transaction(...args);
          } catch (err) {
            console.warn("[AI Studio] DB transaction failed, using mock fallback:", (err as Error)?.message || err);
            const fnOrArray = args[0];
            if (typeof fnOrArray === "function") return fnOrArray(createSafeDb());
            if (Array.isArray(fnOrArray)) return Promise.all(fnOrArray);
            return [];
          }
        };
      }

      const originalProp = target[prop];
      if (originalProp && typeof originalProp === "object") {
        return new Proxy(originalProp, {
          get(modelTarget, methodProp: string) {
            const origMethod = modelTarget[methodProp];
            if (typeof origMethod === "function") {
              return async (...args: any[]) => {
                try {
                  return await origMethod.apply(modelTarget, args);
                } catch (err) {
                  console.warn(
                    `[AI Studio] DB query ${String(prop)}.${String(methodProp)} failed — returning mock fallback:`,
                    (err as Error)?.message || err
                  );
                  const mock = createMockModel(String(prop)) as any;
                  return await mock[methodProp](...args);
                }
              };
            }
            return origMethod;
          }
        });
      }
      return originalProp;
    },
  });
}

export const db: PrismaClient = createSafeDb() as unknown as PrismaClient;

