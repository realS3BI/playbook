FROM mcr.microsoft.com/dotnet/sdk:10.0 AS playbook-builder
WORKDIR /src/Playbook
COPY server-plugin/Playbook/Playbook.csproj ./
RUN dotnet restore Playbook.csproj
COPY server-plugin/Playbook/*.cs ./
RUN dotnet publish Playbook.csproj --no-restore --configuration Release --output /playbook

FROM playbook-builder AS playbook-tests
WORKDIR /src/Playbook.Tests
COPY server-plugin/Playbook.Tests/Playbook.Tests.csproj ./
RUN dotnet restore Playbook.Tests.csproj
COPY server-plugin/Playbook.Tests/*.cs ./
COPY server-plugin/Playbook.Tests/Fixtures/ ./Fixtures/
RUN dotnet test Playbook.Tests.csproj --no-restore --configuration Release

FROM cm2network/cs2:latest

COPY --chmod=0755 cs2/pre.sh /etc/pre.sh
COPY --chmod=0755 cs2/entrypoint.sh /home/steam/entrypoint.sh
COPY --from=playbook-tests /playbook/Playbook.dll /opt/playbook/Playbook.dll
COPY server-plugin/gamedata/playbook-nades.json /opt/playbook/playbook-nades.json

CMD ["bash", "entrypoint.sh"]
