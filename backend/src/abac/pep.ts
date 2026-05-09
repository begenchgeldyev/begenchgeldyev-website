import { evaluate } from './pdp';
import { getSubjectAttributes, getPolicies } from './pip';

type ABACContext = {
  actions: string;
  resource: string;
  resourceAttributes?: Record<string, unknown>;
};

export function enforce(handler: (req: Request) => Promise<Response>, abacContext: ABACContext) {
  return async (req: Request): Promise<Response> => {
    const email = req.headers.get('x-user-email');
    const subject = await getSubjectAttributes(email);
    const policies = await getPolicies();

    const context = {
      ip: req.headers.get('x-forwarded-for') || 'unknown',
      method: req.method,
    };

    const decision = evaluate(
      {
        subject,
        action: abacContext.actions,
        resource: abacContext.resource,
        resourceAttributes: abacContext.resourceAttributes || {},
        context,
      },
      policies,
    );
    
    if (decision === 'deny') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    return handler(req);
  };
}
