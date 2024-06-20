import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { join } from 'path';
import * as hbs from 'hbs';
import * as session from 'express-session';
import * as passport from 'passport';
import { DetailedExceptionFilter } from './filters/detailed-exception.filter';

declare const module: any;

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const config = new DocumentBuilder()
    .setTitle(process.env.swagger_title)
    .setDescription(process.env.swagger_description)
    .setVersion(process.env.swagger_version)
    .addTag(process.env.swagger_tag)
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  app.useStaticAssets(join(__dirname, '..', 'public'));
  app.setBaseViewsDir(join(__dirname, '..', 'views'));
  app.setViewEngine('hbs');
  app.useGlobalFilters(new DetailedExceptionFilter());
  hbs.registerPartials(join(__dirname, '..', 'views', 'partials'));

  app.use(
    session({
      secret: process.env.SESSION_SECRET,
      resave: true,
      saveUninitialized: true,
    }),
  );
  app.use(passport.initialize());
  app.use(passport.session());

  await app.listen(parseInt(process.env.SERVER_PORT));

  if (module.hot) {
    module.hot.accept();
    module.hot.dispose(() => app.close());
  }
}
bootstrap();

// const net = require('net');
// const { v4: uuidv4 } = require('uuid');

// export function sendTcpMessage(message, callback) {
//     const client = new net.Socket();

//     client.connect(4000, '127.0.0.1', () => {
//         console.log('Connected to IronVault server');
//         client.write(JSON.stringify(message));
//     });

//     client.on('data', (data) => {
//         console.log('Received: ' + data);
//         callback(null, JSON.parse(data.toString()));
//         client.destroy(); // kill client after server's response
//     });

//     client.on('close', () => {
//         console.log('Connection closed');
//     });

//     client.on('error', (err) => {
//         console.error('Error: ', err);
//         callback(err);
//     });
// }

// // Test the client
// export function testClient() {
//     // Test setting a key-value pair
//     const setRequest = {
//         Set: {
//             key: `key-${uuidv4()}`,
//             value: 'Hello, IronVault!',
//             ttl: 10000 // TTL in milliseconds
//         }
//     };

//     sendTcpMessage(setRequest, (err, response) => {
//         if (err) {
//             console.error('Failed to send message:', err);
//             return;
//         }
//         console.log('Set Response:', response);

//         // Test getting the key-value pair
//         const getRequest = {
//             Get: {
//                 key: setRequest.Set.key
//             }
//         };

//         sendTcpMessage(getRequest, (err, response) => {
//             if (err) {
//                 console.error('Failed to send message:', err);
//                 return;
//             }
//             console.log('Get Response:', response);

//             // Wait for TTL to expire and try getting the key again
//             setTimeout(() => {
//                 sendTcpMessage(getRequest, (err, response) => {
//                     if (err) {
//                         console.error('Failed to send message:', err);
//                         return;
//                     }
//                     console.log('Get After TTL Expired:', response);
//                 });
//             }, 11000); // Wait 11 seconds to ensure TTL has expired
//         });
//     });
// }
