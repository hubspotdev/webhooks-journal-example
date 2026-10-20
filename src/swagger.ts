import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Webhooks Journal Example API',
      version: '1.0.0',
      description:
        'Example integration app demonstrating the HubSpot Webhooks Journal API with real-time contact syncing',
    },
    servers: [{ url: 'http://localhost:3002', description: 'Development server' }],
  },
  apis: ['./src/routes/*.ts'],
};

export const swaggerSpec = swaggerJsdoc(options);
