# syntax=docker/dockerfile:1

# Comments are provided throughout this file to help you get started.
# If you need more help, visit the Dockerfile reference guide at
# https://docs.docker.com/go/dockerfile-reference/

# Want to help us make this template better? Share your feedback here: https://forms.gle/ybq9Krt8jtBL3iCk7


FROM phusion/passenger-nodejs

# Enable Nginx and Passenger
RUN rm -f /etc/service/nginx/down
ADD webapp.conf /etc/nginx/sites-enabled/webapp.conf
RUN mkdir /home/app/webapp
COPY --chown=app:app . /home/app/webapp
WORKDIR /home/app/webapp
RUN npm install
EXPOSE 80